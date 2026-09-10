/**
 * #825 — reading the `WORKER_HOLD_STALE` refusal.
 *
 * The load-bearing case is `heldByUserId: null` vs the key being ABSENT. They
 * look identical to any check that reads the value without asking whether it is
 * there, and they mean opposite things: null is a definite "nobody holds it
 * now", which is the path where the user's intent already stands; absent means
 * the payload cannot be read at all.
 */
import { describe, it, expect } from 'vitest';
import { readHoldStale, rosterIsStale } from './hold-stale';
import type { ReleaseWorkerMessage } from './schema';

function refusal(extensions: Record<string, unknown>) {
  return { response: { errors: [{ message: 'stale', extensions }] } };
}

const STALE = { code: 'WORKER_HOLD_STALE', workerId: 'worker-1' };

describe('readHoldStale', () => {
  it('reads a null holder as a definite "nobody holds it now"', () => {
    expect(readHoldStale(refusal({ ...STALE, heldByUserId: null }))).toEqual({ kind: 'unheld' });
  });

  it('reads a holder id as a hold that exists', () => {
    expect(readHoldStale(refusal({ ...STALE, heldByUserId: 'u2' }))).toEqual({
      kind: 'held',
      holderId: 'u2',
    });
  });

  // The whole reason this is presence-first. A bare `typeof x === 'string'`
  // check collapses this case into the null case, and they call for opposite
  // responses — the user would be told there is nothing to release on a payload
  // that never said so.
  it('refuses to interpret a payload with no heldByUserId key at all', () => {
    expect(readHoldStale(refusal(STALE))).toBeNull();
  });

  it('refuses to interpret a holder that is present but unusable', () => {
    expect(readHoldStale(refusal({ ...STALE, heldByUserId: '' }))).toBeNull();
    expect(readHoldStale(refusal({ ...STALE, heldByUserId: 42 }))).toBeNull();
  });

  it('ignores errors that are not WORKER_HOLD_STALE', () => {
    expect(readHoldStale(refusal({ code: 'FORBIDDEN', heldByUserId: null }))).toBeNull();
  });

  // A stale refusal can arrive beside other errors; keying on position rather
  // than on the code would read the wrong one.
  it('finds the stale error among several', () => {
    const e = {
      response: {
        errors: [
          { message: 'other', extensions: { code: 'SOMETHING_ELSE' } },
          { message: 'stale', extensions: { ...STALE, heldByUserId: 'u9' } },
        ],
      },
    };
    expect(readHoldStale(e)).toEqual({ kind: 'held', holderId: 'u9' });
  });

  it('is null for transport errors and non-errors', () => {
    expect(readHoldStale(new Error('boom'))).toBeNull();
    expect(readHoldStale({ response: null })).toBeNull();
    expect(readHoldStale(undefined)).toBeNull();
  });
});

/**
 * @codex on #828: the roster refresh hangs entirely off one client callback, so
 * a wrong condition there leaves the suite green while users resubmit the stale
 * holder in the unchanged row.
 */
describe('rosterIsStale', () => {
  it('refreshes on every stale-hold reply', () => {
    expect(rosterIsStale({ type: 'error', staleHold: true, text: 'x' })).toBe(true);
  });

  // The case a `type === 'error'` check would miss. The `heldByUserId: null`
  // reading is reported as a SUCCESS — the end state the user wanted already
  // stands — and the roster is still drawing a hold that has gone.
  it('refreshes on the stale reply that is reported as a SUCCESS', () => {
    expect(rosterIsStale({ type: 'success', outcome: 'not-held', staleHold: true, text: 'x' })).toBe(true);
  });

  it.each([
    ['an ordinary release', { type: 'success', outcome: 'released', text: 'x' }],
    ['an announcement failure', { type: 'success', outcome: 'announcement-failed', text: 'x' }],
    ['an ordinary error', { type: 'error', text: 'nope' }],
  ])('does not refetch for %s', (_what, message) => {
    expect(rosterIsStale(message as ReleaseWorkerMessage)).toBe(false);
  });

  it('does not refetch when there is no message at all', () => {
    expect(rosterIsStale(undefined)).toBe(false);
    expect(rosterIsStale(null)).toBe(false);
  });
});
