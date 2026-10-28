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
  ...over,
});
const client = (impl: () => unknown) => ({ request: vi.fn(async () => impl()) }) as never;
// The grid's handle is hydrated per current task (portal#1349): answer the roster, then each task ref.
const refClient = (workers: unknown[], refs: Record<string, unknown>) =>
  ({
    request: vi.fn(async (q: string, v?: { id: string }) => (q.includes('AgentTaskRef') ? { agentTask: refs[v!.id] ?? null } : { teamRoster: { workers } })),
  }) as never;
const gqlErr = (code: string) => ({ response: { errors: [{ extensions: { code } }] } });

describe('loadAppTeamRoster (#1168)', () => {
  it('reads once and keys the entries by worker id', async () => {
    const c = client(() => ({ teamRoster: { workers: [entry('w1', { currentTask: { id: 't1', title: 'Ship', status: 'STARTED' } }), entry('w2')] } }));
    const r = await loadAppTeamRoster(c, 'app-1');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.byWorker.w1.currentTask?.title).toBe('Ship');
    expect(r.byWorker.w2.currentTask).toBeNull();
    // The roster is read once; the only other read is the task-ref hydration (here, none resolves).
    const calls = (c as unknown as { request: { mock: { calls: unknown[][] } } }).request.mock.calls;
    expect(calls.filter((x) => String(x[0]).includes('TasksTeamRoster') || String(x[0]).includes('AppTeamRoster'))).toHaveLength(1);
  });

  it('the current task gets its immutable handle through the readable-task gate; an unresolved one gets null, never a placeholder', async () => {
    const workers = [
      entry('w1', { currentTask: { id: 't1', title: 'Ship', status: 'STARTED' } }),
      entry('w2', { currentTask: { id: 't2', title: 'Other', status: 'STARTED' } }),
      entry('w3', { currentTask: { id: 't3', title: 'Foreign', status: 'STARTED' } }),
    ];
    const r = await loadAppTeamRoster(
      refClient(workers, {
        t1: { id: 't1', appId: 'app-1', handle: 'AT3.405', title: 'Ship' },
        t3: { id: 't3', appId: 'app-2', handle: 'AT9', title: 'Foreign' },
      }),
      'app-1',
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.byWorker.w1.currentTask?.handle).toBe('AT3.405');
    expect(r.byWorker.w2.currentTask?.handle).toBeNull();
    expect(r.byWorker.w3.currentTask?.handle).toBeNull();
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
