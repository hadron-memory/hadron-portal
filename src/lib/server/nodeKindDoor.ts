// The node-write DOOR CHOOSER — one place that decides which mutation a node
// update goes through (#868).
//
// ## Why this exists at all
//
// hadron-server #1201/#1203 put GOVERNED KINDS behind their own mutations. A
// node's kind is a property of the WRITE, not of the address it lands at, so a
// write that would produce — or that merely TOUCHES — a governed node must come
// through that kind's door. The generic `updateNode` refuses it:
//
//   "This write would produce a RUNNABLE node, which only updateTaskNode may
//    update."
//
// The gate reads the RESULTING state, which is what makes this everyone's
// problem rather than the problem of the few call sites that set `isRunnable`.
// Editing a task node's content still produces a task node, so an ordinary
// "save the body" action — which never mentions a door, a kind or a signal — is
// refused. #867 routed two call sites; eight more were refused and nobody could
// have found them by grepping for `isRunnable`, because none of them mention it
// (hrn:node:hadronmemory.com:dev:findings:a-gate-on-resulting-state-has-no-grep-signature).
//
// ## Why a helper rather than a rule per call site
//
// Eight sites each remembering to route is the shape that produced this. The
// chooser is the default: a call site gets the right door by calling it, and a
// NINTH site added next year has to opt OUT — visibly, in the allowlist
// `scripts/check-node-write-doors.mjs` enforces — rather than remember to opt
// in. A comment saying "remember to route this" would be enforced by whoever
// happens to read the file — see
// hrn:node:hadronmemory.com:hadron-portal:review:comment-cannot-enforce-a-per-instance-rule
//
// ## This register MIRRORS the server's, and that is a liability
//
// The source of truth is `src/lib/governedRole.ts` in hadron-server; there is
// no SDL field, no error-code payload and no query that reports the register,
// so a client that wants to route correctly has no choice but to hold a copy.
// A kind added there is silently missing here. That is reported as a platform
// gap rather than papered over — @Ada raised it on #868, and it is the reason
// `nodeUpdateDocument` refuses an unroutable node loudly instead of guessing.

import {
  UPDATE_NODE_MUTATION,
  UPDATE_TASK_NODE_MUTATION,
  UPDATE_REVIEW_NODE_MUTATION,
  UPDATE_SPEC_NODE_MUTATION,
} from './queries';
import { t } from '$lib/i18n/t';

/** The closed governed subset — mirrors GOVERNED_KINDS in hadron-server. */
export type GovernedKind = 'task' | 'review' | 'spec';

/**
 * The part of a node the gate reads. Both fields are optional in the same way
 * the server's `GovernedState` is: `undefined` means "not mentioned", `null`
 * means "explicitly absent". The distinction is load-bearing in
 * `mergedGovernedState` and a `??` chain collapses it.
 *
 * ## The one thing a caller has to get right, and the type cannot enforce
 *
 * `prior` must come from a read that SELECTED both signals — `NODE_FIELDS`
 * does, and every call site here uses it. A `graphNodes` row from the memory
 * layout does NOT: the server's slim `GraphNode` projection has no `role` field
 * to select, so such a row reads as ungoverned on the role axis no matter what
 * the node is.
 *
 * TypeScript cannot tell the two apart — both are `MemoryNode` — so this is
 * written down rather than typed. The consolation is the failure direction:
 * routing a review node through the generic door is REFUSED by the server, in
 * the same words #868 is about. It fails loudly and it fails at the write,
 * never silently at the wrong address. Reported to the server side as a gap;
 * the fix there is a `role` field on `GraphNode`, not a workaround here.
 */
export interface GovernedState {
  role?: string | null;
  isRunnable?: boolean | null;
}

/**
 * The object being sent as `UpdateNodeInput`. It carries the governance signals
 * when it touches them and arbitrary other fields when it does not — hence the
 * index signature, without which TypeScript's weak-type check rejects every
 * input that mentions neither signal — which is precisely the set #868 is about.
 */
export interface NodeUpdateInput extends GovernedState {
  [field: string]: unknown;
}

interface DoorEntry {
  kind: GovernedKind;
  /** What makes a node this kind. `task` is gated on the CAPABILITY, never on a label. */
  signal: { field: 'role'; value: string } | { field: 'isRunnable' };
  /** The mutation that may write this kind. */
  document: string;
  /** Its operation name, for the refusal message and for tests to name a door in prose. */
  doorName: string;
}

/**
 * THE REGISTER. Deliberately the same three entries, in the same order, with
 * the same signals as hadron-server's `GOVERNED_KINDS` — read it there before
 * changing anything here.
 */
export const NODE_DOORS: readonly DoorEntry[] = [
  {
    kind: 'task',
    signal: { field: 'isRunnable' },
    document: UPDATE_TASK_NODE_MUTATION,
    doorName: 'updateTaskNode',
  },
  {
    kind: 'review',
    signal: { field: 'role', value: 'review' },
    document: UPDATE_REVIEW_NODE_MUTATION,
    doorName: 'updateReviewNode',
  },
  {
    kind: 'spec',
    signal: { field: 'role', value: 'spec' },
    document: UPDATE_SPEC_NODE_MUTATION,
    doorName: 'updateSpecNode',
  },
] as const;

/**
 * `role` is `base` or one of its dotted descendants: hadron-server's
 * `roleIsOrDescendsFrom` (src/lib/governedRole.ts, #1322 / server#1345). The
 * server governs the whole `spec.*` and `review.*` families, so a node with
 * role `spec.feature` must go through the spec door. Matching `spec` exactly
 * sent such writes to the generic `updateNode`, which refuses them (@codex on
 * #931). The dot boundary is load-bearing: `spec` never matches `special`.
 */
export function roleIsOrDescendsFrom(role: string | null | undefined, base: string): boolean {
  return role === base || (typeof role === 'string' && role.startsWith(`${base}.`));
}

/** Which governed kinds a state matches. Usually none; a runnable review is two. */
export function governedKindsOf(state: GovernedState): DoorEntry[] {
  return NODE_DOORS.filter((entry) =>
    entry.signal.field === 'isRunnable'
      ? state.isRunnable === true
      : roleIsOrDescendsFrom(state.role, entry.signal.value),
  );
}

/**
 * The post-write state, applying the server's partial-update semantics (D4):
 * an omitted field PRESERVES, an explicit `null` CLEARS.
 *
 * `undefined` and `null` are different answers here and the difference decides
 * the door: `{}` against a runnable node still produces a runnable node, while
 * `{ isRunnable: false }` against the same node does not.
 */
export function mergedGovernedState(
  existing: GovernedState | null | undefined,
  input: GovernedState,
): GovernedState {
  return {
    role: input.role === undefined ? (existing?.role ?? null) : input.role,
    isRunnable:
      input.isRunnable === undefined ? (existing?.isRunnable ?? null) : input.isRunnable,
  };
}

/**
 * No single mutation can carry this write — raised rather than guessing a door.
 *
 * A node matching TWO governed kinds (a runnable review) has no door at all: a
 * door exempts itself from its own kind and stays subject to every other, so
 * `updateTaskNode` is refused by the review entry and `updateReviewNode` by the
 * task entry. Guessing one produces a server refusal whose message names a door
 * the reader will then try by hand, and which will also refuse. Saying so here
 * is the difference between a dead end and an explained one.
 */
export class NoNodeDoorError extends Error {
  constructor(public readonly kinds: GovernedKind[]) {
    super(
      t(
        'node.write.no-door',
        'This node is both {kinds}, and the platform has no single write path for that combination. Edit it with the hadron CLI.',
        { kinds: kinds.join(' and ') },
      ),
    );
    this.name = 'NoNodeDoorError';
  }
}

/**
 * Choose the mutation document for a node update.
 *
 * `prior` is the node as it is NOW — fetch it, do not infer it. SEVEN of the
 * ten routed call sites never touch a governance signal, so their resulting
 * kind IS the node's current one, and a chooser given only the input would
 * route every one of them through the generic door and be refused exactly as
 * before. (Only the edit page's save, `updateMeta` and `convertToTask` mention
 * a signal at all. The count is the one `scripts/check-node-write-doors.mjs`
 * prints on every run — read it there rather than trusting this sentence.)
 *
 * `input` is the object being sent, not a summary of it. Passing the real input
 * means the signals cannot drift from what the write actually carries.
 *
 * ## BEFORE ∪ AFTER, and the union is the part that is easy to miss
 *
 * The server gates on the union of the kinds the node HAD and the kinds it WILL
 * have, because a result-only gate lets the generic surface UN-GOVERN a node in
 * one call. So un-ticking "Runnable" on a task node is a TASK-door write even
 * though the result is an ordinary node — #867 routed on the submitted value
 * alone and left that direction broken; it is fixed here and pinned by a test.
 */
/**
 * Raise `NoNodeDoorError` NOW if this write has no door.
 *
 * For a call site that performs a side effect before the write — the two edit
 * actions move the node when its loc changed — a refusal raised at the write
 * leaves the node relocated with none of the edit applied (@copilot, PR #869).
 * The door depends on the node's kind and not on its loc, so the question can
 * be asked before the move at no cost.
 *
 * It exists as its own name rather than as a discarded `nodeUpdateDocument()`
 * call because the check gate reads the document argument at each
 * `.request(…)`: hoisting the chooser into a local variable and passing that
 * made two call sites opaque to `check-graphql-callers`, which silently stopped
 * cross-checking their variables — 290 checked call sites down to 288, measured.
 * So the write keeps calling the chooser inline, and this is the precondition.
 */
export function assertNodeUpdateDoor(
  prior: GovernedState | null | undefined,
  input: NodeUpdateInput,
): void {
  nodeUpdateDocument(prior, input);
}

export function nodeUpdateDocument(
  prior: GovernedState | null | undefined,
  input: NodeUpdateInput,
): string {
  const before = governedKindsOf(prior ?? {});
  const after = governedKindsOf(mergedGovernedState(prior, input));

  const affected = new Map<GovernedKind, DoorEntry>();
  for (const entry of [...before, ...after]) affected.set(entry.kind, entry);

  if (affected.size === 0) return UPDATE_NODE_MUTATION;
  if (affected.size === 1) return [...affected.values()][0].document;
  throw new NoNodeDoorError([...affected.keys()]);
}
