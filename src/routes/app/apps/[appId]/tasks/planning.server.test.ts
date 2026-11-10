import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_REF_QUERY, AGENT_TASKS_APP_QUERY, CREATE_AGENT_TASK_MUTATION } from '$lib/server/queries';

const request = vi.fn();
const rawRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request, rawRequest }) }));
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
function event(fields: Record<string, string | string[]>, impersonation: unknown = null) {
  const fd = new FormData();
  for (const [key, values] of Object.entries(fields)) for (const value of Array.isArray(values) ? values : [values]) fd.append(key, value);
  return { request: { formData: async () => fd }, params: { appId: 'app-1', taskId: 't1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
}
beforeEach(() => {
  // portal#1349: a write first resolves the route's task to its canonical id for this App.
  request.mockReset().mockImplementation(async (q: string, v?: { id: string }) =>
    q === AGENT_TASKS_APP_QUERY ? { app } : q === AGENT_TASK_REF_QUERY ? { agentTask: { id: v!.id, appId: app.id } } : {});
  rawRequest.mockReset().mockResolvedValue({ data: { createAgentTask: { id: 't9' } } });
});
async function create(fields: Record<string, string | string[]>) {
  return (await import('./new/+page.server')).actions.default(event({ title: 'Ship', ...fields }));
}
async function actions() {
  return (await import('./[taskId]/+page.server')).actions as Record<string, (e: never) => Promise<unknown>>;
}
describe('portal#1352 task planning writes', () => {
  it('omits untouched create fields, including the server default priority', async () => {
    await expect(create({ priority: '', blockedBy: '' })).rejects.toMatchObject({ status: 303 });
    const input = rawRequest.mock.calls[0][1].input;
    expect(input).not.toHaveProperty('priority');
    expect(input).not.toHaveProperty('blockedBy');
  });
  it('creates priority and all selected blockers atomically in the existing mutation', async () => {
    await expect(create({ priority: '3', blockedBy: ['t2', 't3'] })).rejects.toMatchObject({ status: 303 });
    expect(rawRequest).toHaveBeenCalledExactlyOnceWith(CREATE_AGENT_TASK_MUTATION, { input: expect.objectContaining({ priority: 3, blockedBy: ['t2', 't3'] }) });
  });
  it.each(['0', '6', '1.5', 'garbage'])('refuses invalid priority %s before creating', async (priority) => {
    expect(await create({ priority })).toMatchObject({ status: 400, data: { refusal: { kind: 'invalid', field: 'priority' }, values: { priority } } });
    expect(rawRequest).not.toHaveBeenCalled();
  });
  it('forwards priority with the merged taskRef wire, using the warning-preserving path', async () => {
    await (await actions()).priority(event({ priority: '5' }));
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('setAgentTaskPriority(taskRef: $taskRef, priority: $priority)'), { taskRef: 't1', priority: 5 });
  });
  it.each(['addBlocker', 'removeBlocker'])('%s sends one blocker and uses the server authority', async (action) => {
    await (await actions())[action](event({ blockerTaskRef: 't2' }));
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('blockerTaskRef: $blockerTaskRef'), { taskRef: 't1', blockerTaskRef: 't2' });
  });
  it('preserves the draft and uncertainty without echoing an unknown server error', async () => {
    rawRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'secret sql', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    expect(await (await actions()).priority(event({ priority: '2' }))).toMatchObject({ status: 502, data: { refusal: { kind: 'uncertain' }, values: { priority: '2' } } });
  });
  // portal#1392 (Rook's optional §10 pin on #1388): a cycle is the server's typed refusal, shown with its
  // sentence and the draft kept, never folded into the "may or may not have landed" uncertainty line.
  it('TASK_BLOCKER_CYCLE stays a refused draft, distinct from uncertainty', async () => {
    const message = 'That blocker would make the tasks wait on each other.';
    rawRequest.mockRejectedValueOnce({ response: { errors: [{ message, extensions: { code: 'TASK_BLOCKER_CYCLE' } }] } });
    const out = await (await actions()).addBlocker(event({ blockerTaskRef: 't2' })) as { status: number; data: { refusal: unknown; values: unknown } };
    expect(out.data).toMatchObject({ refusal: { kind: 'refused', code: 'TASK_BLOCKER_CYCLE', message }, values: { blockerTaskRef: 't2' } });
    expect(out.status).not.toBe(502);
  });
  it('impersonation planning writes make no request', async () => {
    expect(await (await actions()).addBlocker(event({ blockerTaskRef: 't2' }, {}))).toMatchObject({ status: 403 });
    expect(rawRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
