import { describe, expect, it } from 'vitest';
import {
  NODE_DOORS,
  NoNodeDoorError,
  governedKindsOf,
  mergedGovernedState,
  nodeUpdateDocument,
} from './nodeKindDoor';
import {
  UPDATE_NODE_MUTATION,
  UPDATE_REVIEW_NODE_MUTATION,
  UPDATE_SPEC_NODE_MUTATION,
  UPDATE_TASK_NODE_MUTATION,
} from './queries';

/**
 * #868 — the chooser.
 *
 * The assertions below name the MUTATION DOCUMENT, never the payload shape.
 * `convert-action.test.ts` passed for the whole life of the outage because it
 * pinned the payload shape and never the door: the action sent exactly the
 * right input to exactly the wrong operation, and a shape assertion cannot see
 * the difference.
 */

const ordinary = { role: null, isRunnable: null };
const task = { role: null, isRunnable: true };
const review = { role: 'review', isRunnable: null };
const spec = { role: 'spec', isRunnable: null };

describe('governedKindsOf', () => {
  it('matches nothing on an ordinary node', () => {
    expect(governedKindsOf(ordinary)).toEqual([]);
  });

  it.each([
    ['a runnable node', task, 'task'],
    ['a review node', review, 'review'],
    ['a spec node', spec, 'spec'],
  ])('matches %s', (_what, state, kind) => {
    expect(governedKindsOf(state).map((e) => e.kind)).toEqual([kind]);
  });

  // The task gate keys on the CAPABILITY, never on a label — a label is
  // caller-set and freely dropped, and omitting isRunnable means the node does
  // not run. So `role: 'task'` is an ordinary node that happens to say "task".
  it('ignores a role that merely says task', () => {
    expect(governedKindsOf({ role: 'task', isRunnable: null })).toEqual([]);
  });

  // An OPEN string with a value outside the closed subset does nothing at all.
  it('ignores an ungoverned role', () => {
    expect(governedKindsOf({ role: 'weather-widget', isRunnable: null })).toEqual([]);
  });

  it('matches BOTH on a runnable review', () => {
    expect(governedKindsOf({ role: 'review', isRunnable: true }).map((e) => e.kind)).toEqual([
      'task',
      'review',
    ]);
  });
});

describe('mergedGovernedState', () => {
  // undefined and null are different answers and a ?? chain collapses them —
  // which is the whole reason this merge is one function and not nine.
  it('preserves an OMITTED field', () => {
    expect(mergedGovernedState(task, {})).toEqual({ role: null, isRunnable: true });
  });

  it('clears on an EXPLICIT null', () => {
    expect(mergedGovernedState(review, { role: null })).toEqual({ role: null, isRunnable: null });
  });

  it('replaces on a value', () => {
    expect(mergedGovernedState(ordinary, { isRunnable: true })).toEqual({
      role: null,
      isRunnable: true,
    });
  });
});

describe('nodeUpdateDocument', () => {
  it('sends an ordinary write through the generic door', () => {
    expect(nodeUpdateDocument(ordinary, { content: 'x' } as never)).toBe(UPDATE_NODE_MUTATION);
  });

  // The six call sites that touch NEITHER signal. Their resulting kind is the
  // node's current one, so the PRIOR state is the only thing that can route
  // them — a chooser given only the input would send every one of them through
  // the generic door and be refused exactly as before #868.
  it.each([
    ['a task node', task, UPDATE_TASK_NODE_MUTATION],
    ['a review node', review, UPDATE_REVIEW_NODE_MUTATION],
    ['a spec node', spec, UPDATE_SPEC_NODE_MUTATION],
  ])('routes a signal-free edit of %s through its own door', (_what, prior, door) => {
    expect(nodeUpdateDocument(prior, {})).toBe(door);
  });

  it('routes a write that PRODUCES a task through the task door', () => {
    expect(nodeUpdateDocument(ordinary, { isRunnable: true })).toBe(UPDATE_TASK_NODE_MUTATION);
  });

  /**
   * The direction #867 got wrong, and the reason this is a fix rather than a
   * refactor. The server gates on BEFORE ∪ AFTER, so un-ticking Runnable on a
   * task node still needs the task door — the refusal even says so in a
   * different voice ("This write would REMOVE the marker…"). Routing on the
   * submitted value alone reads `isRunnable: false`, picks the generic door,
   * and is refused. Converting a node TO a task worked; converting one back
   * did not.
   */
  it('routes a write that REMOVES the task marker through the task door', () => {
    expect(nodeUpdateDocument(task, { isRunnable: false })).toBe(UPDATE_TASK_NODE_MUTATION);
  });

  it('routes a write that CLEARS a review role through the review door', () => {
    expect(nodeUpdateDocument(review, { role: null })).toBe(UPDATE_REVIEW_NODE_MUTATION);
  });

  // Pin the negative too: routing on the submitted value is what the old edit
  // page did, and this is the assertion that tells the two apart. Without it
  // both implementations pass every other case in this file.
  it('does NOT route the removal on the submitted value alone', () => {
    const submittedValueOnly = (input: { isRunnable?: boolean }) =>
      input.isRunnable ? UPDATE_TASK_NODE_MUTATION : UPDATE_NODE_MUTATION;
    expect(submittedValueOnly({ isRunnable: false })).toBe(UPDATE_NODE_MUTATION);
    expect(nodeUpdateDocument(task, { isRunnable: false })).not.toBe(UPDATE_NODE_MUTATION);
  });

  // A node the platform cannot write through any single door. Guessing one
  // produces a server refusal naming a door that will also refuse, so the
  // reader is sent around the same loop twice. Say so once instead.
  it('refuses a node matching two kinds rather than guessing a door', () => {
    expect(() => nodeUpdateDocument({ role: 'review', isRunnable: true }, {})).toThrow(
      NoNodeDoorError,
    );
    expect(() => nodeUpdateDocument({ role: 'review', isRunnable: true }, {})).toThrow(
      /task and review/,
    );
  });

  it('refuses a write that would CREATE the unwritable combination', () => {
    expect(() => nodeUpdateDocument(review, { isRunnable: true })).toThrow(NoNodeDoorError);
  });

  // A null node (the caller could not fetch it) must not be read as "ordinary".
  // It is read as "no prior kind", which is correct: the resulting kind is then
  // whatever the input declares, and an input declaring nothing is ungoverned.
  it('treats a missing prior as no prior kind', () => {
    expect(nodeUpdateDocument(null, { isRunnable: true })).toBe(UPDATE_TASK_NODE_MUTATION);
    expect(nodeUpdateDocument(undefined, {})).toBe(UPDATE_NODE_MUTATION);
  });
});

describe('the register', () => {
  // The liability this module opens with: the source of truth is
  // hadron-server's src/lib/governedRole.ts and nothing on the wire reports it,
  // so this copy can only be kept honest by being read. Pinning the signals
  // makes a silent edit here visible in a diff a reviewer is already reading.
  it('mirrors the server register: three kinds, task on the capability', () => {
    expect(NODE_DOORS.map((e) => e.kind)).toEqual(['task', 'review', 'spec']);
    expect(NODE_DOORS.map((e) => e.doorName)).toEqual([
      'updateTaskNode',
      'updateReviewNode',
      'updateSpecNode',
    ]);
    expect(NODE_DOORS.find((e) => e.kind === 'task')?.signal).toEqual({ field: 'isRunnable' });
  });

  it('gives every kind a distinct document', () => {
    expect(new Set(NODE_DOORS.map((e) => e.document)).size).toBe(NODE_DOORS.length);
    expect(NODE_DOORS.map((e) => e.document)).not.toContain(UPDATE_NODE_MUTATION);
  });
});
