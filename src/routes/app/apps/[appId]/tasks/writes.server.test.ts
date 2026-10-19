/**
 * portal#1090 — the task page's write actions and the create page's action.
 * Each calls the existing mutation and surfaces its typed refusal (design §5);
 * authority stays the server's (hrn:node:hadronmemory.com:specs:cor:agt:050:09). Impersonation writes nothing.
 * portal#1143: Park (an unassigned PENDING task back to the backlog) is one more write on the same path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASKS_APP_QUERY,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  CREATE_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  PARK_AGENT_TASK_MUTATION,
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
  it('the page has exactly these write actions', async () => {
    expect(Object.keys(await taskActions()).sort()).toEqual(['assign', 'cancel', 'park', 'ready', 'reassign']);
  });

  // portal#1143
  it('park calls parkAgentTask with the route’s task id', async () => {
    request.mockResolvedValue({});
    expect(await (await taskActions()).park(event({}))).toEqual({ action: 'park', ok: true });
    expect(request).toHaveBeenLastCalledWith(PARK_AGENT_TASK_MUTATION, { taskId: 't1' });
    expect(PARK_AGENT_TASK_MUTATION).toContain('parkAgentTask(taskId: $taskId) { id }');
  });

  it.each([
    ['TASK_NOT_OWNER', 403],
    ['TASK_ENDED', 409],
    ['TASK_INVALID_TRANSITION', 409],
  ])('park surfaces %s as a %i refusal with the server’s sentence', async (code, status) => {
    request.mockRejectedValueOnce(gqlError(code, `server says ${code}`));
    const r = (await (await taskActions()).park(event({}))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({ action: 'park', refusal: { kind: 'refused', code, message: `server says ${code}` } });
  });

  it('park with an unknown failure is uncertain, never the raw text', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const r = (await (await taskActions()).park(event({}))) as { data: Record<string, unknown> };
    expect(r.data).toMatchObject({ action: 'park', refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(r.data)).not.toContain('prisma');
  });

  it('park in an impersonation session writes nothing', async () => {
    const r = (await (await taskActions()).park(event({}, { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 }))) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
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

  // Diego's P2-2 on #1135: an explicit "Someone else…" left blank is not Me
  // or Nobody. It is refused on its field, and nothing is created.
  it('a blank "Someone else" owner is refused on the owner, not read as Me', async () => {
    answer({ createAgentTask: { id: 't9' } });
    const r = (await create({ title: 'T', start: 'now', owner: 'other', ownerOther: '  @ ', assignee: 'nobody' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ refusal: { kind: 'invalid', field: 'owner' }, values: { owner: 'other' } });
    expect(request.mock.calls.some((c) => c[0] === CREATE_AGENT_TASK_MUTATION)).toBe(false);
  });

  it('a blank "Someone else" assignee is refused on the assignee, not read as Nobody', async () => {
    answer({ createAgentTask: { id: 't9' } });
    const r = (await create({ title: 'T', start: 'now', owner: 'me', assignee: 'other', assigneeOther: '' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ refusal: { kind: 'invalid', field: 'assignee' } });
    expect(request.mock.calls.some((c) => c[0] === CREATE_AGENT_TASK_MUTATION)).toBe(false);
  });

  it('a backlog task still ignores a hidden blank "Someone else" assignee', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'backlog', owner: 'me', assignee: 'other', assigneeOther: '' })).rejects.toMatchObject({ status: 303 });
  });

  // Diego's P2-3 on #1135: the browser converts the chosen local time with
  // that DATE's own offset and sends the instant; without JS it reads as UTC.
  it('Start by uses the instant the browser computed for the chosen date', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'now', owner: 'me', assignee: 'nobody', startBy: '2026-12-01T09:00', startByUtc: '2026-12-01T14:00:00.000Z' }))
      .rejects.toMatchObject({ status: 303 });
    const input = (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> }).input;
    expect(input.startBy).toBe('2026-12-01T14:00:00.000Z');
  });

  it('without the browser’s instant, Start by reads as UTC', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'now', owner: 'me', assignee: 'nobody', startBy: '2026-12-01T09:00' })).rejects.toMatchObject({ status: 303 });
    const input = (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> }).input;
    expect(input.startBy).toBe('2026-12-01T09:00:00.000Z');
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
