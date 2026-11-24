/**
 * portal#1637 — the task page loader's findings read: the page asks only for a task WITH a result (no LazySection otherwise), and the first page
 * reads when the section is shown as a typed value (a failure never rejects and never reads as empty), and the shared detail read
 * and every other read stay as they were.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY, AGENT_TASK_FINDINGS_QUERY } from '$lib/server/queries';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
let task: Record<string, unknown>;
const request = vi.fn(async (q: string, vars?: Record<string, unknown>) => {
  if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
  if (q === AGENT_TASK_FINDINGS_QUERY) return { agentTask: { id: task.id, appId: 'app-1', result: { findings: { items: [{ id: 'F1', severity: 'P1', text: 'one' }], total: 1, hasMore: false } } }, vars };
  return {};
});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: async () => app, loadWriteCandidates: async () => ({ workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] }),
  loadTree: async () => [], loadHistory: async () => [], loadReview: async () => ({ kind: 'ok', value: { readiness: null, seat: null } }),
  loadAncestors: async () => ({ ancestors: [], truncated: false }), canonicalTaskId: (id: string) => id, canonicalTaskRef: async () => ({ appId: 'app-1', taskId: String(task.id) }), loadReferences: async () => [],
}));
vi.mock('$lib/server/task-planning', () => ({ taskDependencies: async () => [], taskClonesPage: async () => ({ kind: 'ok', value: { items: [], total: 0, hasMore: false } }) }));
const locals = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: undefined };
// portal#2261: the findings read is the sections endpoint's, read when the section is shown.
const run = async () => { const { GET } = await import('./[taskId]/sections/+server'); const r = (await GET({ params: { appId: 'app-1', taskId: 'x' }, locals, url: new URL('https://x/sections?section=findings') } as never)) as Response; return { findings: r.json() as Promise<unknown> }; };
beforeEach(() => { request.mockClear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('task page sections: findings', () => {
  it('a task with a result streams the first page (canonical id, limit 20, offset 0)', async () => {
    task = { id: 'T1', appId: 'app-1', status: 'FINISHED', result: { outcome: 'ok', summary: null, evidence: null } };
    const data = await run();
    expect(await data.findings).toEqual({ kind: 'page', page: { taskId: 'T1', offset: 0, items: [{ id: 'F1', severity: 'P1', text: 'one' }], total: 1, hasMore: false } });
    expect(request).toHaveBeenCalledWith(AGENT_TASK_FINDINGS_QUERY, { ref: 'T1', limit: 20, offset: 0 });
  });
  it('a failed findings read RESOLVES {kind:"failed"} (never rejects, never empty); the page still loads', async () => {
    task = { id: 'T3', appId: 'app-1', status: 'FINISHED', result: { outcome: 'ok', summary: null, evidence: null } };
    request.mockReset().mockImplementation(async (q: string) => { if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task }; if (q === AGENT_TASK_FINDINGS_QUERY) throw new Error('Cannot query field "findings"'); return {}; });
    const data = await run();
    await expect(data.findings).resolves.toEqual({ kind: 'failed' });
  });
  it('a findings read that hangs past the bound resolves failed', async () => {
    vi.useFakeTimers();
    task = { id: 'T4', appId: 'app-1', status: 'FINISHED', result: { outcome: 'ok', summary: null, evidence: null } };
    request.mockReset().mockImplementation(async (q: string) => { if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task }; return new Promise(() => {}); });
    const { GET } = await import('./[taskId]/sections/+server');
    const settled = vi.fn();
    void Promise.resolve(GET({ params: { appId: 'app-1', taskId: 'x' }, locals, url: new URL('https://x/sections?section=findings') } as never)).then(settled);
    await vi.advanceTimersByTimeAsync(7000); expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await (settled.mock.calls[0][0] as Response).json()).toEqual({ kind: 'failed' });
    vi.useRealTimers();
  });
});
