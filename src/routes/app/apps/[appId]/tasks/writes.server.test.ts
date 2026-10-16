/**
 * portal#1090 — the task page's write actions and the create page's action.
 * Each calls the existing mutation and surfaces its typed refusal (design §5);
 * authority stays the server's (hrn:node:hadronmemory.com:specs:cor:agt:050:09). Impersonation writes nothing.
 * Park is held: there is no park action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASKS_APP_QUERY,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  CREATE_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  REASSIGN_AGENT_TASK_MUTATION,
} from '$lib/server/queries';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function event(fields: Record<string, string | string[]>, impersonation: unknown = null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return {
    request: { formData: async () => fd },
    params: { appId: 'app-1', taskId: 't1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation },
  } as never;
}

async function taskActions() {
  return (await import('./[taskId]/+page.server')).actions as Record<string, (e: never) => Promise<unknown>>;
}

describe('task page actions', () => {
  it('there is no park action', async () => {
    expect(Object.keys(await taskActions()).sort()).toEqual(['assign', 'cancel', 'ready', 'reassign']);
  });

  it('make ready, assign, reassign and cancel each call their own mutation', async () => {
    request.mockResolvedValue({});
    const a = await taskActions();
    expect(await a.ready(event({}))).toEqual({ action: 'ready', ok: true });
    expect(request).toHaveBeenLastCalledWith(MAKE_AGENT_TASK_READY_MUTATION, { taskId: 't1' });
    expect(await a.cancel(event({}))).toEqual({ action: 'cancel', ok: true });
    expect(request).toHaveBeenLastCalledWith(CANCEL_AGENT_TASK_MUTATION, { taskId: 't1' });
    await a.assign(event({ assignee: 'worker:w1' }));
    expect(request).toHaveBeenLastCalledWith(ASSIGN_AGENT_TASK_MUTATION, { taskId: 't1', assignee: { worker: 'w1' } });
    await a.reassign(event({ assignee: 'other', assigneeOther: '@rae' }));
    expect(request).toHaveBeenLastCalledWith(REASSIGN_AGENT_TASK_MUTATION, { taskId: 't1', assignee: { user: 'rae' } });
  });

  it('sends closeSessionWhenDone only when the reader changed it', async () => {
    request.mockResolvedValue({});
    const a = await taskActions();
    await a.assign(event({ assignee: 'user:u2', closeSessionWhenDoneWas: 'true', closeSessionWhenDone: 'on' }));
    expect(request.mock.calls.at(-1)?.[1]).not.toHaveProperty('closeSessionWhenDone');
    await a.assign(event({ assignee: 'user:u2', closeSessionWhenDoneWas: 'true' }));
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ closeSessionWhenDone: false });
  });

  it('a typed refusal comes back verbatim, with the reader’s values', async () => {
    request.mockRejectedValueOnce(gqlError('TASK_NOT_OWNER', "Only the task's owner, a worker the owner reports to, or whoever manages the App, assigns it."));
    const r = (await (await taskActions()).assign(event({ assignee: 'worker:w1' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).toMatchObject({
      action: 'assign',
      refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: "Only the task's owner, a worker the owner reports to, or whoever manages the App, assigns it." },
      values: { assignee: 'worker:w1' },
    });
  });

  it('a stale view (TASK_INVALID_TRANSITION) is a 409 with the server’s sentence', async () => {
    request.mockRejectedValueOnce(gqlError('TASK_INVALID_TRANSITION', 'Only a backlog task is made ready to be worked.'));
    const r = (await (await taskActions()).ready(event({}))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ refusal: { code: 'TASK_INVALID_TRANSITION' } });
  });

  it('an unknown failure is uncertain, never the raw text', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const r = (await (await taskActions()).cancel(event({}))) as { status: number; data: Record<string, unknown> };
    expect(r.data).toMatchObject({ action: 'cancel', refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(r.data)).not.toContain('prisma');
  });

  it('assigning nobody is refused locally, and calls nothing', async () => {
    const r = (await (await taskActions()).assign(event({ assignee: '' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'assign', refusal: { kind: 'invalid', field: 'assignee' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('an impersonation session writes nothing', async () => {
    const r = (await (await taskActions()).cancel(event({}, { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'FORBIDDEN', message: 'Impersonation sessions are read-only.' } });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('create action (tasks/new)', () => {
  async function create(fields: Record<string, string | string[]>, impersonation: unknown = null) {
    const { actions } = await import('./new/+page.server');
    return actions.default(event(fields, impersonation)) as Promise<unknown>;
  }
  const answer = (created: unknown) =>
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : created));

  it('creates a root task to start now and redirects to it', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({
      title: '  Ship it  ', description: 'Do the thing', start: 'now', owner: 'me', assignee: 'nobody',
      role: 'portal-engineer', familyIn: ['claude'], source: 'https://x.test/1', tags: 'a, b ,', closeSessionWhenDone: 'on',
    })).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/tasks/t9?created=1' });
    expect(request).toHaveBeenCalledWith(CREATE_AGENT_TASK_MUTATION, {
      input: {
        appRef: 'app-1', title: 'Ship it', description: 'Do the thing', closeSessionWhenDone: true,
        requirements: { role: 'portal-engineer', familyIn: ['claude'] }, source: 'https://x.test/1', tags: ['a', 'b'],
      },
    });
  });

  it('a backlog task sends BACKLOG and no assignee or requirements, even if the hidden fields hold some', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'Later', start: 'backlog', owner: 'me', assignee: 'worker:w1', role: 'x' })).rejects.toMatchObject({ status: 303 });
    const input = (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> }).input;
    expect(input.status).toBe('BACKLOG');
    expect(input).not.toHaveProperty('assignee');
    expect(input).not.toHaveProperty('requirements');
  });

  it('names an owner and an assignee when picked', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'now', owner: 'user:u2', assignee: 'worker:w1' })).rejects.toMatchObject({ status: 303 });
    const input = (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ owner: { user: 'u2' }, assignee: { worker: 'w1' } });
    expect(input).not.toHaveProperty('requirements');
  });

  it('an empty title is refused on the title, and calls nothing', async () => {
    answer({});
    const r = (await create({ title: '   ', start: 'now' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ refusal: { kind: 'invalid', field: 'title' } });
    expect(request.mock.calls.some((c) => c[0] === CREATE_AGENT_TASK_MUTATION)).toBe(false);
  });

  it('a refusal keeps every value the reader typed', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw gqlError('TASK_ASSIGNEE_INVALID', '@ghost is not a possible assignee in this App: …');
    });
    const fields = { title: 'T', description: 'D', start: 'now', owner: 'me', assignee: 'other', assigneeOther: '@ghost', tags: 'x' };
    const r = (await create(fields)) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'TASK_ASSIGNEE_INVALID' }, values: fields });
  });

  it('an impersonation session creates nothing', async () => {
    answer({});
    const r = (await create({ title: 'T', start: 'now' }, { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 })) as { status: number };
    expect(r.status).toBe(403);
    expect(request.mock.calls.some((c) => c[0] === CREATE_AGENT_TASK_MUTATION)).toBe(false);
  });
});
