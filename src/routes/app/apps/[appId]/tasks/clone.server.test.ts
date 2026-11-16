/**
 * portal#2161 — the New task page's clone branch (hadron-server#3244,
 * `cloneAgentTask`; hrn:node:hadronmemory.com:specs:cor:agt:050:02 "What a
 * clone does"). The form posts each copied field beside its base and the action
 * sends only the changes; an emptied field is sent empty, never dropped (the
 * server would copy the source's value back). The refusals render the issue's
 * Ask-3 wording with the values kept. `createAgentTask` is never called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY, AGENT_TASK_REF_QUERY, CLONE_AGENT_TASK_MUTATION, CREATE_AGENT_TASK_MUTATION } from '$lib/server/queries';

const request = vi.fn();
const rawRequest = vi.fn();
const delegate = async (q: string, v: unknown) => ({ data: await request(q, v), extensions: undefined, status: 200 });
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gated = async (q: string, v?: unknown) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) {
    const id = (v as { id: string }).id;
    // The source resolves canonically inside THIS App; a crafted `from` that names
    // nothing readable answers null (the neutral-404 branch of canonicalTaskId).
    if (id === 'src-1' || id === 'canon-1') return { agentTask: { id: 'canon-1', appId: 'app-1' } };
    return { agentTask: null };
  }
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

/** The clone form, unchanged: every copied field beside its base, the parent kept, priority copied. */
const BASE: Record<string, string | string[]> = {
  from: 'src-1',
  title: 'Ship it', titleBase: 'Ship it',
  description: 'The plan', descriptionBase: 'The plan',
  source: 'http://x', sourceBase: 'http://x',
  tags: 'a, b', tagsBase: 'a, b',
  closeSessionWhenDone: 'on', closeSessionWhenDoneBase: 'true',
  references: '[]', referencesBase: '[]',
  requirementsBase: JSON.stringify({ role: null, familyIn: [], familyNotIn: [], excludeWorkers: [], minTier: null }),
  role: '', minTier: '', familyIn: [], familyNotIn: [], excludeWorkers: [],
  cloneParent: 'parent:parent-1', cloneParentBase: 'parent:parent-1',
  priority: 'copied',
  start: 'now', owner: 'me', ownerOther: '', assignee: 'nobody', assigneeOther: '',
  startBy: '', startByUtc: '',
};
function event(over: Record<string, string | string[]> = {}, impersonation: unknown = null, drop: string[] = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...BASE, ...over })) {
    if (drop.includes(k)) continue;
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  }
  return { request: { formData: async () => fd }, params: { appId: 'app-1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
}
/** The action's success answers with a redirect; a refusal answers with fail(). Both are outcomes. */
async function post(over: Record<string, string | string[]> = {}, impersonation: unknown = null, drop: string[] = []) {
  const act = (await import('./new/+page.server')).actions as unknown as { default: (e: never) => Promise<unknown> };
  try {
    return { ret: (await act.default(event(over, impersonation, drop))) as Record<string, any> };
  } catch (e) {
    return { thrown: e as { status?: number; location?: string; body?: { message?: string } } };
  }
}
const cloneVars = () => rawRequest.mock.calls.at(-1)![1] as { taskId: string; input: Record<string, unknown> };

describe('clone save: the call (acceptance 2, 3, 5)', () => {
  it('an unchanged pre-filled form clones the canonical source with an empty input, and never creates', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    const out = await post();
    expect(out.thrown?.status).toBe(303);
    expect(out.thrown?.location).toBe('/app/apps/app-1/tasks/new-1?created=1');
    expect(rawRequest).toHaveBeenCalledTimes(1);
    const [doc] = rawRequest.mock.calls[0]!;
    expect(doc).toBe(CLONE_AGENT_TASK_MUTATION);
    expect(doc).toContain('cloneAgentTask(taskId: $taskId, input: $input)');
    expect(cloneVars()).toEqual({ taskId: 'canon-1', input: {} });
    // Priority left copied and properties untouched name neither (acceptance 5).
    expect(cloneVars().input).not.toHaveProperty('priority');
    expect(cloneVars().input).not.toHaveProperty('properties');
    expect(CREATE_AGENT_TASK_MUTATION).toContain('createAgentTask');
    expect(request.mock.calls.every(([q]) => !String(q).includes('createAgentTask'))).toBe(true);
    expect(rawRequest.mock.calls.every(([q]) => !String(q).includes('createAgentTask'))).toBe(true);
  });

  it('a changed title goes as the override; nothing else does', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ title: 'Redone' });
    expect(cloneVars()).toEqual({ taskId: 'canon-1', input: { title: 'Redone' } });
  });

  it('choosing "No project" sends parentTaskId: null; picking another parent sends its id', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ cloneParent: 'none' });
    expect(cloneVars().input).toEqual({ parentTaskId: null });
    await post({ cloneParent: 'parent:picked-1' });
    expect(cloneVars().input).toEqual({ parentTaskId: 'picked-1' });
  });

  it('a "No project" pre-fill left unchanged sends no parentTaskId at all (acceptance 4)', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ cloneParent: 'none', cloneParentBase: 'none' });
    expect(cloneVars()).toEqual({ taskId: 'canon-1', input: {} });
    expect(cloneVars().input).not.toHaveProperty('parentTaskId');
  });

  it('an emptied field is sent empty, never dropped: a cleared description sends "" (acceptance 3, pinned)', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ description: '' });
    expect(cloneVars().input).toEqual({ description: '' });
  });

  it('cleared tags send []', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ tags: '' });
    expect(cloneVars().input).toEqual({ tags: [] });
  });

  it('a named priority is sent; "copied" never is', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ priority: '3' });
    expect(cloneVars().input).toEqual({ priority: 3 });
  });

  it('a backlog start sends BACKLOG and no assignee; a picked assignee is sent otherwise', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ start: 'backlog', assignee: 'worker:w2' });
    expect(cloneVars().input).toEqual({ status: 'BACKLOG' });
    await post({ assignee: 'worker:w2' });
    expect(cloneVars().input).toEqual({ assignee: { worker: 'w2' } });
  });
});

describe('clone save: hidden requirements controls keep the copy (review on #2161)', () => {
  // A source WITH requirements: the form hides the controls on a backlog start or a named
  // assignee, so their fields never post — that must read as "unchanged", never as "emptied".
  const reqBase = JSON.stringify({ role: 'portal-engineer', familyIn: ['claude'], familyNotIn: [], excludeWorkers: ['w9'], minTier: 'T1' });
  const hidden = ['role', 'minTier', 'familyIn', 'familyNotIn', 'excludeWorkers'];

  it('a named assignee hides the controls: the copy stands, no requirements is sent', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ requirementsBase: reqBase, assignee: 'worker:w2' }, null, hidden);
    expect(cloneVars().input).toEqual({ assignee: { worker: 'w2' } });
  });

  it('a backlog start hides them the same way', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ requirementsBase: reqBase, start: 'backlog', assignee: 'worker:w2' }, null, hidden);
    expect(cloneVars().input).toEqual({ status: 'BACKLOG' });
  });

  it('visible controls changed against their base still override — the gate swallows no real edit', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ requirementsBase: reqBase, role: 'server-engineer' });
    expect(cloneVars().input).toEqual({ requirements: { role: 'server-engineer' } });
  });

  it('visible controls emptied against their base clear the copy: requirements null', async () => {
    request.mockResolvedValue({ cloneAgentTask: { id: 'new-1' } });
    await post({ requirementsBase: reqBase, role: '', minTier: '', familyIn: [], familyNotIn: [], excludeWorkers: [] });
    expect(cloneVars().input).toEqual({ requirements: null });
  });
});

describe('clone save: refusals keep the form (acceptance 6)', () => {
  it.each([
    ['TASK_NOT_ASSIGNEE', 403, 'The parent can’t be kept: you can’t create a task under it. Choose another parent, or none.'],
    ['TASK_ENDED', 409, 'The parent you chose has ended. Choose another parent, or none.'],
    ['TASK_NOT_OWNER', 403, 'You can’t set that priority. Leave it copied, or choose one you may set.'],
    ['TASK_NOT_FOUND', 404, 'Task not found'],
  ])('%s renders its sentence with the values kept', async (code, status, message) => {
    request.mockRejectedValue(gqlError(code, `server says ${code}`));
    const out = await post({ title: 'My draft' });
    expect(out.thrown).toBeUndefined();
    expect(out.ret!.status).toBe(status);
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'refused', code, message } });
    expect(out.ret!.data.values).toMatchObject({ title: 'My draft', from: 'src-1' });
  });

  it('TASK_NOT_FOUND says exactly "Task not found" — no reason given', async () => {
    request.mockRejectedValue(gqlError('TASK_NOT_FOUND', 'No task with id src-1 in this App.'));
    const out = await post();
    expect(out.ret!.data.refusal.message).toBe('Task not found');
    expect(JSON.stringify(out.ret!.data)).not.toContain('No task with id');
  });

  it('BAD_USER_INPUT (AT0) renders the server’s message verbatim with the form kept', async () => {
    const message = 'AT0 is the reserved "No project" project and cannot be cloned.';
    request.mockRejectedValue(gqlError('BAD_USER_INPUT', message));
    const out = await post();
    expect(out.ret!.status).toBe(400);
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message } });
    expect(out.ret!.data.values).toMatchObject({ from: 'src-1' });
  });

  it('an unlisted create-gate code renders the server’s message as given, with the form kept', async () => {
    request.mockRejectedValue(gqlError('APP_UNINSTALLED', 'This App was uninstalled.'));
    const out = await post({ title: 'My draft' });
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'refused', code: 'APP_UNINSTALLED', message: 'This App was uninstalled.' } });
    expect(out.ret!.data.values).toMatchObject({ title: 'My draft' });
  });

  it('an emptied title is refused on the title and calls nothing', async () => {
    const out = await post({ title: '   ' });
    expect(out.ret!.status).toBe(400);
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'invalid', field: 'title' } });
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('a `from` that resolves to nothing is the neutral 404, not a refusal', async () => {
    const out = await post({ from: 'gone-1' });
    expect(out.thrown?.status).toBe(404);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('an unknown failure is uncertain, never the raw text', async () => {
    request.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const out = await post({ title: 'My draft' });
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(out.ret!.data)).not.toContain('prisma');
  });

  it('an impersonation session writes nothing, even with a crafted post', async () => {
    const out = await post({ title: 'Changed' }, { as: 'someone' });
    expect(out.ret!.data).toMatchObject({ refusal: { kind: 'refused', code: 'FORBIDDEN' } });
    expect(rawRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
