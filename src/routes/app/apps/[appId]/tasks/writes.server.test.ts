/**
 * portal#1090 — the task page's write actions and the create page's action.
 * Each calls the existing mutation and surfaces its typed refusal (design §5);
 * authority stays the server's (hrn:node:hadronmemory.com:specs:cor:agt:050:09). Impersonation writes nothing.
 * portal#1143: Park (an unassigned PENDING task back to the backlog) is one more write on the same path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import {
  AGENT_TASKS_APP_QUERY,
  AGENT_TASK_REF_QUERY,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  CREATE_AGENT_TASK_MUTATION,
  HAND_BACK_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  PARK_AGENT_TASK_MUTATION,
  REASSIGN_AGENT_TASK_MUTATION,
} from '$lib/server/queries';

const request = vi.fn();
// portal#1214: create, assign and reassign go through rawRequest to keep
// extensions. By default it answers what `request` would, with no extensions.
const rawRequest = vi.fn();
const delegate = async (q: string, v: unknown) => ({ data: await request(q, v), extensions: undefined, status: 200 });
// portal#1349: a write first resolves the route's task to its canonical id (the App
// read, then the readable-task gate). That resolution answers here; everything else
// reaches `request`, so the assertions about mutations are unchanged.
const resolver = vi.fn(async (_q: string, v: { ref: string }) => ({ agentTask: { id: v.ref === 'AT3.405' || v.ref.endsWith(':AT3.405') ? 'canon-1' : v.ref, appId: 'app-1' } }));
const gated = async (q: string, v?: unknown) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) return resolver(q, v as { ref: string });
  return request(q, v);
};
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: gated, rawRequest }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  rawRequest.mockReset();
  rawRequest.mockImplementation(delegate);
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
    expect(Object.keys(await taskActions()).sort()).toEqual(['addBlocker', 'assign', 'cancel', 'disposeFinding', 'edit', 'handBack', 'park', 'priority', 'ready', 'reassign', 'removeBlocker']);
  });

  // portal#1571 (hadron-server#2651, hrn:node:hadronmemory.com:specs:cor:agt:050:29)
  it('handBack calls handBackAgentTask with the route’s task id and the chosen code and text', async () => {
    request.mockResolvedValue({});
    expect(await (await taskActions()).handBack(event({ code: 'MISSING_INPUT', text: ' no key ' }))).toEqual({ action: 'handBack', ok: true });
    expect(request).toHaveBeenLastCalledWith(HAND_BACK_AGENT_TASK_MUTATION, { taskRef: 't1', reason: { code: 'MISSING_INPUT', text: 'no key' } });
    expect(HAND_BACK_AGENT_TASK_MUTATION).toContain('handBackAgentTask(taskRef: $taskRef, reason: $reason)');
  });

  it('handBack leaves the text out when it is blank', async () => {
    request.mockResolvedValue({});
    await (await taskActions()).handBack(event({ code: 'DUPLICATE', text: '   ' }));
    expect(request).toHaveBeenLastCalledWith(HAND_BACK_AGENT_TASK_MUTATION, { taskRef: 't1', reason: { code: 'DUPLICATE' } });
  });

  it.each([[''], ['SHRUG']])('handBack with the code %j asks the server nothing', async (code) => {
    const r = (await (await taskActions()).handBack(event({ code, text: 'x' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'handBack', refusal: { kind: 'invalid', field: 'code' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('handBack with text over 2,000 characters asks the server nothing', async () => {
    const r = (await (await taskActions()).handBack(event({ code: 'REFUSED', text: 'x'.repeat(2001) }))) as { data: Record<string, unknown> };
    expect(r.data).toMatchObject({ action: 'handBack', refusal: { kind: 'invalid', field: 'text' } });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['TASK_NOT_ASSIGNEE', 403],
    ['TASK_INVALID_TRANSITION', 409],
    ['TASK_ENDED', 409],
  ])('handBack surfaces %s as a %i refusal with the server’s sentence', async (code, status) => {
    request.mockRejectedValueOnce(gqlError(code, `server says ${code}`));
    const r = (await (await taskActions()).handBack(event({ code: 'REFUSED', text: '' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({ action: 'handBack', refusal: { kind: 'refused', code, message: `server says ${code}` } });
  });

  it('handBack in an impersonation session writes nothing', async () => {
    const r = (await (await taskActions()).handBack(event({ code: 'REFUSED' }, { by: 'admin' }))) as { data: Record<string, unknown> };
    expect(r.data).toMatchObject({ action: 'handBack' });
    expect(request).not.toHaveBeenCalled();
  });

  // portal#1143
  it('park calls parkAgentTask with the route’s task id', async () => {
    request.mockResolvedValue({});
    expect(await (await taskActions()).park(event({}))).toEqual({ action: 'park', ok: true });
    expect(request).toHaveBeenLastCalledWith(PARK_AGENT_TASK_MUTATION, { taskRef: 't1' });
    expect(PARK_AGENT_TASK_MUTATION).toContain('parkAgentTask(taskRef: $taskRef) { id }');
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
    expect(request).toHaveBeenLastCalledWith(MAKE_AGENT_TASK_READY_MUTATION, { taskRef: 't1' });
    expect(await a.cancel(event({}))).toEqual({ action: 'cancel', ok: true });
    expect(request).toHaveBeenLastCalledWith(CANCEL_AGENT_TASK_MUTATION, { taskRef: 't1' });
    await a.assign(event({ assignee: 'worker:w1' }));
    expect(request).toHaveBeenLastCalledWith(ASSIGN_AGENT_TASK_MUTATION, { taskRef: 't1', assignee: { worker: 'w1' } });
    await a.reassign(event({ assignee: 'other', assigneeOther: '@rae' }));
    expect(request).toHaveBeenLastCalledWith(REASSIGN_AGENT_TASK_MUTATION, { taskRef: 't1', assignee: { user: 'rae' } });
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

  it('a minimum model tier is sent in the requirements; Any sends none (portal#1523)', async () => {
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'now', owner: 'me', assignee: 'nobody', minTier: 'mid' })).rejects.toMatchObject({ status: 303 });
    expect(request).toHaveBeenLastCalledWith(CREATE_AGENT_TASK_MUTATION, expect.objectContaining({ input: expect.objectContaining({ requirements: { minTier: 'mid' } }) }));
    request.mockClear();
    answer({ createAgentTask: { id: 't9' } });
    await expect(create({ title: 'T', start: 'now', owner: 'me', assignee: 'nobody', minTier: '' })).rejects.toMatchObject({ status: 303 });
    const input = (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)![1] as { input: Record<string, unknown> }).input;
    expect(input).not.toHaveProperty('requirements');
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

// ---------------------------------------------------------------------------
// portal#1214 — the warnings a write's response carries (hadron-server#2198).
// ---------------------------------------------------------------------------

const PRIVATE = 'PRIVATE-SENTINEL prisma stack at /srv/app';
const URN = 'hrn:node:hadronmemory.com:hadron-dev-team-roles:tasks:find-a-source';
const warning = (path: string, code = 'task.assign.assignee-busy', extra: Record<string, unknown> = {}) => ({
  path, code, text: `text for ${code}`, ...extra,
});
/** A success answer with extensions, as graphql-request's rawRequest returns it. */
const answered = (data: unknown, warnings: unknown[]) => ({ data, extensions: { warnings }, status: 200 });
/**
 * A response whose write committed but whose envelope also errored. With one
 * root field per request, the only legal shape is an error WITHOUT a path:
 * the server drops warnings for any path that errored (taskWarningsPlugin).
 */
const committedError = (warnings: unknown[], data: unknown = null) =>
  new ClientError(
    { data, errors: [{ message: PRIVATE, extensions: { code: 'INTERNAL_SERVER_ERROR' } }] as never, extensions: { warnings }, status: 200, headers: new Headers(), body: PRIVATE },
    { query: 'mutation' },
  );

describe('task page actions: warnings (portal#1214)', () => {
  it.each([
    ['assign', 'assignAgentTask', ASSIGN_AGENT_TASK_MUTATION],
    ['reassign', 'reassignAgentTask', REASSIGN_AGENT_TASK_MUTATION],
  ])('%s returns its own path’s warnings, verbatim and in order', async (action, path, doc) => {
    rawRequest.mockResolvedValueOnce(answered({ [path]: { id: 't1' } }, [
      warning(path, 'task.assign.assignee-unavailable', { register: { state: 'mapped', taskLoc: 'tasks:find-a-source', taskUrn: URN } }),
      warning('someOtherKey'),
      warning(path, 'task.future.code', { register: { state: 'unmapped' } }),
    ]));
    const r = await (await taskActions())[action](event({ assignee: 'worker:w1' }));
    expect(rawRequest).toHaveBeenLastCalledWith(doc, { taskRef: 't1', assignee: { worker: 'w1' } });
    expect(r).toEqual({
      action, ok: true, committedWithError: false, more: 0,
      warnings: [
        { code: 'task.assign.assignee-unavailable', text: 'text for task.assign.assignee-unavailable', register: { state: 'mapped', taskLoc: 'tasks:find-a-source', taskUrn: URN } },
        { code: 'task.future.code', text: 'text for task.future.code', register: { state: 'unmapped' } },
      ],
    });
  });

  it('assign with no extensions is a plain success with no warnings', async () => {
    request.mockResolvedValueOnce({ assignAgentTask: { id: 't1' } });
    expect(await (await taskActions()).assign(event({ assignee: 'worker:w1' }))).toEqual({ action: 'assign', ok: true, committedWithError: false, warnings: [], more: 0 });
  });

  it('a committed write whose response errored is saved, never refused, and leaks no error text', async () => {
    rawRequest.mockRejectedValueOnce(committedError([warning('assignAgentTask')]));
    const r = await (await taskActions()).assign(event({ assignee: 'worker:w1' }));
    expect(r).toEqual({
      action: 'assign', ok: true, committedWithError: true, more: 0,
      warnings: [{ code: 'task.assign.assignee-busy', text: 'text for task.assign.assignee-busy' }],
    });
    expect(JSON.stringify(r)).not.toContain('PRIVATE-SENTINEL');
  });

  it('a malformed warning still proves the commit: shown as saved with nothing listed', async () => {
    rawRequest.mockRejectedValueOnce(committedError([{ path: 'reassignAgentTask', code: 9 }]));
    expect(await (await taskActions()).reassign(event({ assignee: 'worker:w1' }))).toMatchObject({ ok: true, committedWithError: true, warnings: [] });
  });

  it('an error without this path’s warning is today’s refusal, byte for byte', async () => {
    rawRequest.mockRejectedValueOnce(committedError([warning('someOtherKey')]));
    const r = (await (await taskActions()).assign(event({ assignee: 'worker:w1' }))) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(502);
    expect(r.data).toEqual({ action: 'assign', refusal: { kind: 'uncertain' }, values: { assignee: 'worker:w1' } });
    expect(JSON.stringify(r.data)).not.toContain('PRIVATE-SENTINEL');

    rawRequest.mockRejectedValueOnce(gqlError('TASK_NOT_OWNER', 'You don’t own this task.'));
    const typed = (await (await taskActions()).assign(event({ assignee: 'worker:w1' }))) as { status: number; data: Record<string, unknown> };
    expect(typed.status).toBe(403);
    expect(typed.data).toMatchObject({ refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'You don’t own this task.' } });
  });

  it('make ready, park and cancel are untouched: no rawRequest, no warnings field', async () => {
    request.mockResolvedValue({});
    const a = await taskActions();
    expect(await a.ready(event({}))).toEqual({ action: 'ready', ok: true });
    expect(await a.park(event({}))).toEqual({ action: 'park', ok: true });
    expect(await a.cancel(event({}))).toEqual({ action: 'cancel', ok: true });
    expect(rawRequest).not.toHaveBeenCalled();
  });
});

describe('create action: warnings (portal#1214)', () => {
  async function create(fields: Record<string, string | string[]> = { title: 'T', start: 'now', owner: 'me', assignee: 'nobody' }) {
    const { actions } = await import('./new/+page.server');
    return actions.default(event(fields)) as Promise<unknown>;
  }
  beforeEach(() => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { createAgentTask: { id: 't9' } }));
  });

  it('a create with warnings is answered in place, not redirected', async () => {
    rawRequest.mockResolvedValueOnce(answered({ createAgentTask: { id: 't9' } }, [warning('createAgentTask', 'task.create.no-source')]));
    expect(await create()).toEqual({
      created: { id: 't9', handle: null }, committedWithError: false, more: 0,
      warnings: [{ code: 'task.create.no-source', text: 'text for task.create.no-source' }],
    });
  });

  it('a create whose only warnings are another path’s still redirects', async () => {
    rawRequest.mockResolvedValueOnce(answered({ createAgentTask: { id: 't9' } }, [warning('assignAgentTask')]));
    await expect(create()).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/tasks/t9?created=1' });
  });

  it('a create whose warnings are all malformed redirects: nothing to show, and the id proves it landed', async () => {
    rawRequest.mockResolvedValueOnce(answered({ createAgentTask: { id: 't9' } }, [{ path: 'createAgentTask', text: 'no code' }]));
    await expect(create()).rejects.toMatchObject({ status: 303 });
  });

  it('a committed create whose response errored has no id: it links to the list and leaks nothing', async () => {
    rawRequest.mockRejectedValueOnce(committedError([warning('createAgentTask', 'task.create.no-source')]));
    const r = await create();
    expect(r).toEqual({
      created: { id: null, handle: null }, committedWithError: true, more: 0,
      warnings: [{ code: 'task.create.no-source', text: 'text for task.create.no-source' }],
    });
    expect(JSON.stringify(r)).not.toContain('PRIVATE-SENTINEL');
  });

  it('a returned id that isn’t a plain id is never linked', async () => {
    rawRequest.mockResolvedValueOnce(answered({ createAgentTask: { id: '../../evil?x=1' } }, [warning('createAgentTask', 'task.create.no-source')]));
    expect(await create()).toMatchObject({ created: { id: null } });
  });

  it('no usable id and no warning to prove it is the fixed uncertainty line, not a crash', async () => {
    rawRequest.mockResolvedValueOnce(answered({ createAgentTask: null }, []));
    const r = (await create()) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(502);
    expect(r.data).toMatchObject({ refusal: { kind: 'uncertain' } });
  });

  it('a refused create is today’s refusal, with the values', async () => {
    rawRequest.mockRejectedValueOnce(gqlError('TASK_OWNER_INVALID', 'No such owner.'));
    const r = (await create()) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'TASK_OWNER_INVALID', message: 'No such owner.' }, values: { title: 'T' } });
  });
});

// portal#1349: the identity a write sends is the server's canonical id for THIS App's route.
describe('task page actions: handle routes', () => {
  const at = (taskId: string) => ({ ...(event({}) as unknown as Record<string, unknown>), params: { appId: 'app-1', taskId } }) as never;

  it('a write from a handle URL sends the canonical id, never the URL segment', async () => {
    request.mockResolvedValue({});
    await (await taskActions()).park(at('AT3.405'));
    expect(request).toHaveBeenLastCalledWith(PARK_AGENT_TASK_MUTATION, { taskRef: 'canon-1' });
    expect(resolver).toHaveBeenLastCalledWith(AGENT_TASK_REF_QUERY, { ref: 'hrn:agenttask:acme.com:team:AT3.405' });
  });

  it('a planning write from a handle URL sends the canonical id as its taskRef', async () => {
    const fd = new FormData();
    fd.append('priority', '2');
    const e = { ...(at('AT3.405') as unknown as Record<string, unknown>), request: { formData: async () => fd } } as never;
    await (await taskActions()).priority(e);
    expect(rawRequest).toHaveBeenLastCalledWith(expect.stringContaining('setAgentTaskPriority'), { taskRef: 'canon-1', priority: 2 });
  });

  it('another App’s qualified handle writes nothing and resolves nothing', async () => {
    request.mockResolvedValue({});
    resolver.mockClear();
    await expect((await taskActions()).cancel(at('hrn:agenttask:acme.com:other:AT3.405'))).rejects.toMatchObject({ status: 404 });
    expect(resolver).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  // Dorian's BLIND P2: the resolution read can refuse or fail, not only answer null.
  it.each(['FORBIDDEN', 'NOT_FOUND', 'TASK_NOT_FOUND', 'APP_NOT_FOUND'])('a %s refusal resolving the task is the same neutral 404 and writes nothing', async (code) => {
    request.mockResolvedValue({});
    resolver.mockRejectedValueOnce(gqlError(code, 'Forbidden'));
    await expect((await taskActions()).cancel(at('AT3.405'))).rejects.toMatchObject({ status: 404, body: { message: 'Task not found' } });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['a transport failure', new TypeError('fetch failed')],
    ['an unknown server fault', gqlError('INTERNAL_SERVER_ERROR', 'secret sql')],
  ])('%s resolving the task is the uncertain write failure, with the values, and writes nothing', async (_label, failure) => {
    request.mockResolvedValue({});
    resolver.mockRejectedValueOnce(failure);
    const fd = new FormData();
    fd.append('priority', '2');
    const e = { ...(at('AT3.405') as unknown as Record<string, unknown>), request: { formData: async () => fd } } as never;
    expect(await (await taskActions()).priority(e)).toMatchObject({ status: 502, data: { refusal: { kind: 'uncertain' }, values: { priority: '2' } } });
    expect(rawRequest).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('a task the server resolves into another App writes nothing', async () => {
    request.mockResolvedValue({});
    resolver.mockResolvedValueOnce({ agentTask: { id: 'canon-9', appId: 'app-2' } });
    await expect((await taskActions()).cancel(at('t1'))).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});
