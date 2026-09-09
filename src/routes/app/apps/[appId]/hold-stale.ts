/**
 * #825 — reading a `WORKER_HOLD_STALE` refusal.
 *
 * `releaseWorker` accepts `expectedHolderUserId`, and a mismatch refuses with
 * the hold found NOW, at the moment the guarded write rejected the assertion
 * (hadron-server#1084). This turns that refusal into something the action can
 * branch on.
 *
 * A module rather than a branch in the action, for the same reason as
 * `release-notice.ts`: the interesting half is the decision, and the decision
 * has three outcomes that a test can state in one line each.
 */

/**
 * What the refusal says about the hold as it stands now.
 *
 * `null` means "do not interpret this" — either the error is not
 * `WORKER_HOLD_STALE`, or its payload cannot be read. Both fall through to
 * ordinary error handling, which is always available; guessing at a payload is
 * what produces a claim nobody can back.
 */
export type HoldStale =
  | { kind: 'unheld' }
  | { kind: 'held'; holderId: string }
  | null;

type GqlErrorShape = {
  response?: {
    errors?: { extensions?: Record<string, unknown> }[];
  };
};

/**
 * `heldByUserId: null` is a DEFINITE "held by nobody now" — what a caller who
 * asserted a specific holder gets when the name was released underneath them,
 * and it means the thing they wanted has already happened. An ABSENT key means
 * the payload cannot be interpreted at all. The two call for opposite responses,
 * so collapsing them would report a server error the user can do nothing about,
 * on the one path where nothing is wrong.
 *
 * hadron-cli's reader opens with an explicit `_, present := e.Extensions[…]`
 * check for this, and I wrote one here too — then a mutation removing it left
 * every test green. It is redundant in THIS language: Go decodes a JSON null and
 * an absent key both to `""`, so presence is the only thing that separates them,
 * while here absent is `undefined` and null is `null`, and `=== null` already
 * means "present, and null". The check was a true sentence about Go transcribed
 * into TypeScript as a line that cannot fail.
 *
 * So the distinction is enforced by `=== null` being checked BEFORE the
 * string test, and by the tests pinning both readings — not by a guard that
 * looks load-bearing and is not.
 */
export function readHoldStale(e: unknown): HoldStale {
  if (!e || typeof e !== 'object' || !('response' in e)) return null;

  const errors = (e as GqlErrorShape).response?.errors;
  const extensions = errors?.find((err) => err?.extensions?.code === 'WORKER_HOLD_STALE')?.extensions;
  if (!extensions) return null;

  const heldBy = extensions.heldByUserId;
  if (heldBy === null) return { kind: 'unheld' };
  if (typeof heldBy === 'string' && heldBy !== '') return { kind: 'held', holderId: heldBy };

  // Present, but neither null nor a usable id: uninterpretable, so say so
  // rather than inventing a reading of it.
  return null;
}
