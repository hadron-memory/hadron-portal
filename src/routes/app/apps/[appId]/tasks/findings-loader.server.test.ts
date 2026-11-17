/**
 * portal#1637 — the task page loader's findings read: only a task WITH a result is asked, the first page
 * streams as a typed value (a failure never rejects and never reads as empty), and the shared detail read
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
  loadAncestors: async () => ({ ancestors: [], truncated: false }), canonicalTaskId: (id: string) => id, loadReferences: async () => [],
}));
vi.mock('$lib/server/task-planning', () => ({ taskDependencies: async () => [], taskClonesPage: async () => ({ kind: 'ok', value: { items: [], total: 0, hasMore: false } }) }));
const locals = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: undefined };
const run = async () => { const { load } = await import('./[taskId]/+page.server'); return (await load({ params: { appId: 'app-1', taskId: 'x' }, locals, url: new URL('https://x/') } as never)) as { findings: Promise<unknown> }; };
beforeEach(() => { request.mockClear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('task page loader: findings', () => {
  it('a task with a result streams the first page (canonical id, limit 20, offset 0)', async () => {
    task = { id: 'T1', appId: 'app-1', status: 'FINISHED', result: { outcome: 'ok', summary: null, evidence: null } };
    const data = await run();
    expect(await data.findings).toEqual({ kind: 'page', page: { taskId: 'T1', offset: 0, items: [{ id: 'F1', severity: 'P1', text: 'one' }], total: 1, hasMore: false } });
    expect(request).toHaveBeenCalledWith(AGENT_TASK_FINDINGS_QUERY, { id: 'T1', limit: 20, offset: 0 });
  });
  it('a task with no result asks nothing and is no-result', async () => {
    task = { id: 'T2', appId: 'app-1', status: 'PENDING', result: null };
    const data = await run();
    expect(await data.findings).toEqual({ kind: 'no-result' });
    expect(request.mock.calls.some(([q]) => q === AGENT_TASK_FINDINGS_QUERY)).toBe(false);
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
    const data = await run(); const settled = vi.fn(); void data.findings.then(settled);
    await vi.advanceTimersByTimeAsync(7000); expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500); expect(await data.findings).toEqual({ kind: 'failed' });
    vi.useRealTimers();
  });
});
