/**
 * #1050 / `hrn:node:hadronmemory.com:specs:cor:agt:020:09` — deriving what to say about a worker name's HOLD.
 *
 * A name is held by a PERSON until they explicitly release it. Expiry, a reap
 * and a closed chat session do not free one. That makes "taken" two different
 * questions, and the portal must not blur them:
 *
 *   HELD    whose name is this — standing, survives everything but a release
 *   TAKEN   is a live session bound right now — and only ever a question about
 *           your OWN worker, since HELD is what stops anyone else binding
 *
 * This module answers the first only. The portal has no session-liveness read
 * on the roster and should not invent one.
 *
 * ── The three-valued trap ────────────────────────────────────────────────────
 *
 * `Worker.heldByUserId` is a WORKING-STATE field: behind the worker read gate
 * and **masked to null on deny**, like `prompt` and `memoryId` and
 * unlike `name`/`role`/`urn`. So a null carries two meanings that the wire
 * cannot separate:
 *
 *   1. nobody holds this name
 *   2. somebody does, and you are not allowed to know who
 *
 * There is no second signal that distinguishes them — every other
 * working-state field is legitimately null on plenty of workers, so "they were
 * all null" proves nothing. We therefore refuse to render "Not held", because
 * on a denied read that is a confident false statement about staffing. `none`
 * means *not-held-or-not-visible*, and its copy has to survive both readings.
 */

/** What the UI should say about a name's hold. */
export type WorkerHold =
  /** The field was not selected by this query — render nothing at all. */
  | { kind: 'unselected' }
  /**
   * Null on the wire: nobody holds it, OR the read was denied and the holder
   * was masked. Deliberately ONE state, because the client cannot tell them
   * apart and a UI that guesses is asserting staffing it did not read.
   */
  | { kind: 'none' }
  /** Held by the signed-in user. `since` is null only if the server sent a
   *  holder without a `heldAt`, which the schema says cannot happen. */
  | { kind: 'self'; since: string | null; holderId: string }
  /** Held by somebody else. The holder is unnamed until the server grows a
   *  resolved `heldByUser: User` (portal#748) — resolving it client-side would
   *  be an N+1 per roster row. */
  | { kind: 'other'; since: string | null; holderId: string };

/** The subset of a Worker this needs — so callers can pass a slim projection. */
export interface WorkerHoldFields {
  heldByUserId?: string | null;
  heldAt?: string | null;
}

/**
 * Derive the hold state.
 *
 * `viewerId` is the signed-in user's id. When it is absent we can still say a
 * name IS held — we just cannot say it is yours, so it degrades to `other`
 * rather than to `none`. That direction matters: `none` would under-report a
 * real hold, while `other` under-personalises a true one.
 */
export function workerHold(
  worker: WorkerHoldFields | null | undefined,
  viewerId: string | null | undefined,
): WorkerHold {
  if (!worker || worker.heldByUserId === undefined) return { kind: 'unselected' };
  if (worker.heldByUserId === null) return { kind: 'none' };

  // #825 — `holderId` rides on the two HELD states so a caller can assert the
  // hold it is acting on without re-deriving it from the raw field. On `self`
  // and `other` it is a non-null string by construction (both null and
  // undefined returned above), which is what lets the release control pass it
  // where TypeScript can check it — narrowing `kind` narrows the id with it.
  // Deliberately absent from `none`/`unselected`: there is no holder to name,
  // and an empty string there would be a value that reads as one.
  const since = worker.heldAt ?? null;
  const holderId = worker.heldByUserId;
  return worker.heldByUserId === viewerId
    ? { kind: 'self', since, holderId }
    : { kind: 'other', since, holderId };
}

/** True when a hold is known to exist — i.e. someone's name this is. */
export function isHeld(hold: WorkerHold): boolean {
  return hold.kind === 'self' || hold.kind === 'other';
}

/** The holder identity a roster read may show for a hold: `holder` is a RosterHolder-shaped value. */
export interface HolderIdentity {
  id: string;
  name: string | null;
  handle: string | null;
  urn: string | null;
}

/**
 * portal#1330 — the roster's `heldBy` is a SECOND read beside `Worker.heldByUserId`, and the two can
 * disagree (a transfer between the reads, a stale tick). Identity is shown only when the holder IS the
 * hold's holder; a mismatch, a masked null or an absent roster entry yields null, which callers render
 * as the existing withheld/unknown line. Never a guess, and never a fresh identity fetch.
 */
export function holderForHold<H extends HolderIdentity>(hold: WorkerHold, holder: H | null | undefined): H | null {
  if (!holder || (hold.kind !== 'self' && hold.kind !== 'other')) return null;
  return holder.id === hold.holderId ? holder : null;
}

/** What to call a holder: the name, else the handle. An empty or blank string counts as unset (`??` would keep it). */
export function holderLabel(holder: Pick<HolderIdentity, 'name' | 'handle'> | null | undefined): string | null {
  return holder?.name?.trim() || holder?.handle?.trim() || null;
}
