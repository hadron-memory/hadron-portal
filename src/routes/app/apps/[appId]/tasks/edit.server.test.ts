/**
 * portal#1357 — the task page's `edit` action (hadron-server#2645,
 * `updateAgentTask`; hrn:node:hadronmemory.com:specs:cor:agt:050:09 Editing,
 * Proposed except source-fixed and the creator refusal). It sends the patch
 * for the route's canonical task only, and the server decides who may.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY, AGENT_TASK_REF_QUERY, UPDATE_AGENT_TASK_MUTATION } from '$lib/server/queries';

const request = vi.fn();
const rawRequest = vi.fn();
const delegate = async (q: string, v: unknown) => ({ data: await request(q, v), extensions: undefined, status: 200 });
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gated = async (q: string, v?: unknown) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: (v as { id: string }).id === 'AT3.405' ? 'canon-1' : (v as { id: string }).id, appId: 'app-1' } };
  return request(q, v);
};
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: gated, rawRequest }) }));
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  rawRequest.mockReset();
  rawRequest.mockImplementation(delegate);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const BASE: Record<string, string | string[]> = {
  title: 'Ship it', titleBase: 'Ship it', description: '', descriptionBase: '', tags: '', tagsBase: '',
  startBy: '', startByUtc: '', startByBase: '', closeSessionWhenDone: 'on', closeSessionWhenDoneBase: 'true',
  role: '', requirementsBase: JSON.stringify({ role: null, familyIn: [], familyNotIn: [], excludeWorkers: [] }),
};
function event(over: Record<string, string | string[]> = {}, impersonation: unknown = null, taskId = 't1') {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...BASE, ...over })) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return { request: { formData: async () => fd }, params: { appId: 'app-1', taskId }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
}
const edit = async (e: never) => ((await import('./[taskId]/+page.server')).actions as Record<string, (e: never) => Promise<unknown>>).edit(e) as Promise<Record<string, any>>;

describe('edit action: the call', () => {
  it('sends the route’s canonical task and only the changed fields', async () => {
    request.mockResolvedValue({ updateAgentTask: { id: 'canon-1' } });
    expect(await edit(event({ title: 'Ship it now', description: 'More' }, null, 'AT3.405'))).toEqual({ action: 'edit', ok: true, committedWithError: false, warnings: [], more: 0 });
    expect(rawRequest).toHaveBeenLastCalledWith(UPDATE_AGENT_TASK_MUTATION, { taskId: 'canon-1', input: { title: 'Ship it now', description: 'More' } });
    expect(UPDATE_AGENT_TASK_MUTATION).toContain('updateAgentTask(taskId: $taskId, input: $input)');
  });

  it('a posted taskId, owner, assignee, status or source never reaches the call', async () => {
    request.mockResolvedValue({});
    await edit(event({ title: 'Changed', taskId: 'other', owner: 'worker:x', assignee: 'worker:y', status: 'FINISHED', source: 'http://x' }));
    const [, vars] = rawRequest.mock.calls.at(-1)!;
    expect(vars).toEqual({ taskId: 't1', input: { title: 'Changed' } });
  });

  it('a save with nothing changed calls nothing and says so', async () => {
    expect(await edit(event())).toEqual({ action: 'edit', ok: true, unchanged: true });
    expect(rawRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('clearing the description sends an explicit null', async () => {
    request.mockResolvedValue({});
    await edit(event({ description: '', descriptionBase: 'was here' }));
    expect(rawRequest.mock.calls.at(-1)![1]).toEqual({ taskId: 't1', input: { description: null } });
  });
});

describe('edit action: refusals keep the draft', () => {
  it('an emptied title is refused on the title and calls nothing', async () => {
    const r = await edit(event({ title: '   ' }));
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'edit', refusal: { kind: 'invalid', field: 'title' }, values: { title: '   ' } });
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('the server’s own BAD_USER_INPUT (e.g. too long) is shown inline, verbatim, with the values', async () => {
    request.mockRejectedValue(gqlError('BAD_USER_INPUT', 'title is longer than 200 characters.'));
    const r = await edit(event({ title: 'x'.repeat(300) }));
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'edit', refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message: 'title is longer than 200 characters.' } });
    expect(r.data.values.title).toHaveLength(300);
  });

  it.each([
    ['TASK_NOT_OWNER', 403],
    ['TASK_ENDED', 409],
    ['TASK_NOT_FOUND', 404],
  ])('%s is a %i refusal with the server’s sentence and the draft', async (code, status) => {
    request.mockRejectedValue(gqlError(code, `server says ${code}`));
    const r = await edit(event({ title: 'My draft' }));
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({ action: 'edit', refusal: { kind: 'refused', code, message: `server says ${code}` }, values: { title: 'My draft' } });
  });

  it('an unknown failure is uncertain (never "nothing changed"), never the raw text, and is not retried', async () => {
    request.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const r = await edit(event({ title: 'My draft' }));
    expect(r.data).toMatchObject({ action: 'edit', refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(r.data)).not.toContain('prisma');
    expect(rawRequest).toHaveBeenCalledTimes(1);
  });

  it('a transport failure is uncertain too', async () => {
    request.mockRejectedValue(new Error('socket hang up'));
    expect((await edit(event({ title: 'My draft' }))).data).toMatchObject({ refusal: { kind: 'uncertain' } });
  });

  it('an impersonation session writes nothing, even with a crafted post', async () => {
    const r = await edit(event({ title: 'Changed' }, { as: 'someone' }));
    expect(r.data).toMatchObject({ action: 'edit', refusal: { kind: 'refused', code: 'FORBIDDEN' } });
    expect(rawRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
