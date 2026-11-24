/**
 * portal#1168 (hadron-server#2178) — the AI Team grid's Task and Paused state
 * come from ONE bulk teamRoster read, classified: a refusal or an outage is a
 * state, never an empty roster.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadAppTeamRoster } from './app-team-roster';
import { APP_TEAM_ROSTER_QUERY } from './queries';

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  worker: { id },
  checkStatus: { status: 'OK', pendingReason: null },
  pausedUntil: null,
  currentTask: null,
  heldBy: null,
  ...over,
});
const client = (impl: () => unknown) => ({ request: vi.fn(async () => impl()) }) as never;
// The grid's handle is hydrated per current task (portal#1349): answer the roster, then each task ref.
const refClient = (workers: unknown[], refs: Record<string, unknown>) =>
  ({
    request: vi.fn(async (q: string, v?: { ref: string }) => (q.includes('AgentTaskRef') ? { agentTask: refs[v!.ref] ?? null } : { teamRoster: { workers } })),
  }) as never;
const gqlErr = (code: string) => ({ response: { errors: [{ extensions: { code } }] } });

describe('loadAppTeamRoster (#1168)', () => {
  it('reads once and keys the entries by worker id', async () => {
    const c = refClient([entry('w1', { currentTask: { id: 't1', title: 'Ship', status: 'STARTED' } }), entry('w2')], {
      t1: { id: 't1', appId: 'app-1', handle: 'AT1', title: 'Ship' },
    });
    const r = await loadAppTeamRoster(c, 'app-1');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.byWorker.w1.currentTask?.title).toBe('Ship');
    expect(r.byWorker.w2.currentTask).toBeNull();
    expect(r.byWorker.w2.currentTaskUnavailable).toBeUndefined();
    // The roster is read once; the only other read is the task-ref hydration.
    const calls = (c as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls;
    expect(calls.filter((x) => String(x[0]).includes('TasksTeamRoster') || String(x[0]).includes('AppTeamRoster'))).toHaveLength(1);
  });

  it('the current task gets its immutable handle through the readable-task gate', async () => {
    const r = await loadAppTeamRoster(
      refClient([entry('w1', { currentTask: { id: 't1', title: 'Ship', status: 'STARTED' } })], {
        t1: { id: 't1', appId: 'app-1', handle: 'AT3.405', title: 'Ship' },
      }),
      'app-1',
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.byWorker.w1.currentTask).toEqual({ id: 't1', title: 'Ship', status: 'STARTED', handle: 'AT3.405' });
    expect(r.byWorker.w1.currentTaskUnavailable).toBeUndefined();
  });

  // Greta LOCAL P2 on portal#1375: an unresolved current task keeps nothing of
  // the roster's summary (no stale title, id or link), and is not "no task".
  it('a missing, foreign or failed current-task read is unavailable: no stale title or id, and not "no task"', async () => {
    const workers = [
      entry('w1', { currentTask: { id: 't-null', title: 'Stale private title', status: 'STARTED' } }),
      entry('w2', { currentTask: { id: 't-foreign', title: 'Stale private title', status: 'STARTED' } }),
      entry('w3', { currentTask: { id: 't-boom', title: 'Stale private title', status: 'STARTED' } }),
      entry('w4'),
    ];
    const c = {
      request: vi.fn(async (q: string, v?: { ref: string }) => {
        if (!q.includes('AgentTaskRef')) return { teamRoster: { workers } };
        if (v!.ref === 't-boom') throw new Error('socket hang up');
        if (v!.ref === 't-foreign') return { agentTask: { id: 't-foreign', appId: 'app-2', handle: 'AT9', title: 'Foreign' } };
        return { agentTask: null };
      }),
    } as never;
    const r = await loadAppTeamRoster(c, 'app-1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    for (const w of ['w1', 'w2', 'w3']) {
      expect(r.byWorker[w].currentTask).toBeNull();
      expect(r.byWorker[w].currentTaskUnavailable).toBe(true);
      expect(JSON.stringify(r.byWorker[w])).not.toMatch(/Stale private title|t-null|t-foreign|t-boom|AT9/);
    }
    expect(r.byWorker.w4.currentTask).toBeNull();
    expect(r.byWorker.w4.currentTaskUnavailable).toBeUndefined();
  });

  it('carries the holder identity through unchanged (hadron-server#2223)', async () => {
    const heldBy = { id: 'u1', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder', name: 'Sample Holder' };
    const r = await loadAppTeamRoster(client(() => ({ teamRoster: { workers: [entry('w1', { heldBy }), entry('w2')] } })), 'app-1');
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

describe('terminal status (portal#1492)', () => {
  it('selects status, reason and checkedAt only: no host label, prompt or last turn on the grid read', () => {
    const sel = APP_TEAM_ROSTER_QUERY.match(/terminal\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(sel.split(/\s+/).filter(Boolean).sort()).toEqual(['checkedAt', 'reason', 'status']);
    expect(sel).not.toMatch(/host|prompt|lastTurnAt|reportedAt/);
  });

  it('passes a returned terminal through, and keeps a returned null as null', async () => {
    const terminal = { status: 'locked', reason: 'model_at_capacity', checkedAt: '2026-10-31T11:55:00.000Z' };
    const r = await loadAppTeamRoster(refClient([entry('w1', { terminal }), entry('w2', { terminal: null })], {}), 'app-1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.byWorker.w1.terminal).toEqual(terminal);
    expect(r.byWorker.w2.terminal).toBeNull();
    // portal#1495 (BLIND hygiene): the w3 assertion this replaced asserted
    // nothing — w3 was never in the fixture. The "on the grid, no roster
    // entry" case it gestured at is covered for real in page.client.test.ts.
  });
});
