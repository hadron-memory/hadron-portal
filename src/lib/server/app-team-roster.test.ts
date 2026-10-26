/**
 * portal#1168 (hadron-server#2178) — the AI Team grid's Task and Paused state
 * come from ONE bulk teamRoster read, classified: a refusal or an outage is a
 * state, never an empty roster.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadAppTeamRoster } from './app-team-roster';

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  worker: { id },
  checkStatus: { status: 'OK', pendingReason: null },
  pausedUntil: null,
  currentTask: null,
  heldBy: null,
  heldAt: null,
  ...over,
});
const client = (impl: () => unknown) => ({ request: vi.fn(async () => impl()) }) as never;
const gqlErr = (code: string) => ({ response: { errors: [{ extensions: { code } }] } });

describe('loadAppTeamRoster (#1168)', () => {
  it('reads once and keys the entries by worker id', async () => {
    const c = client(() => ({ teamRoster: { workers: [entry('w1', { currentTask: { id: 't1', title: 'Ship', status: 'STARTED' } }), entry('w2')] } }));
    const r = await loadAppTeamRoster(c, 'app-1');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.byWorker.w1.currentTask?.title).toBe('Ship');
    expect(r.byWorker.w2.currentTask).toBeNull();
    expect((c as unknown as { request: { mock: { calls: unknown[] } } }).request.mock.calls).toHaveLength(1);
  });

  it('carries the holder identity through unchanged (hadron-server#2223)', async () => {
    const heldBy = { id: 'u1', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder', name: 'Sample Holder' };
    const r = await loadAppTeamRoster(client(() => ({ teamRoster: { workers: [entry('w1', { heldBy, heldAt: '2026-10-11T04:46:36Z' }), entry('w2')] } })), 'app-1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.byWorker.w1.heldBy).toEqual(heldBy);
    expect(r.byWorker.w2.heldBy).toBeNull();
  });

  it('a refusal (APP_NOT_FOUND, FORBIDDEN) is hidden, not an empty roster', async () => {
    for (const code of ['APP_NOT_FOUND', 'FORBIDDEN']) {
      const r = await loadAppTeamRoster(client(() => { throw gqlErr(code); }), 'app-1');
      expect(r.kind).toBe('hidden');
    }
  });

  it('an outage is failed, distinct from hidden and from empty, and never throws', async () => {
    expect((await loadAppTeamRoster(client(() => { throw new Error('boom'); }), 'app-1')).kind).toBe('failed');
    expect((await loadAppTeamRoster(client(() => { throw gqlErr('INTERNAL_SERVER_ERROR'); }), 'app-1')).kind).toBe('failed');
  });

  it('a genuinely empty roster is ok with no entries', async () => {
    const r = await loadAppTeamRoster(client(() => ({ teamRoster: { workers: [] } })), 'app-1');
    expect(r).toEqual({ kind: 'ok', byWorker: {} });
  });
});
