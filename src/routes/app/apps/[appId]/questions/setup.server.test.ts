/**
 * portal#2237 (Questions P4) — the `createQuestionLog` action. The server decides who may create a log: the portal shows the form to
 * every participant and lets a typed refusal explain. What it checks itself is only that the memory and the deciders are ones it offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_MEMORY_SCOPE_QUERY } from '../app-memories';
import { APP_PEOPLE_QUERY, CREATE_QUESTION_LOG_MUTATION, TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { questionLogRefusal } from '$lib/questions/refusal';
import { setupDeciderChoices, setupMemoryChoices } from './setup';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });
const scopeRow = (id: string, cls: string, kinds: string[] = ['APP_MEMORY']) => ({ memoryId: id, memoryUrn: `hrn:mem:acme.com:${id}`, name: `Memory ${id}`, class: cls, viewerCanWrite: true, sources: kinds.map((kind) => ({ kind, agentId: null })) });
const member = (id: string, name: string) => ({ user: { id, handle: name.toLowerCase(), name } });
let scope: unknown[] = [];
let members: unknown = [];
let createError: unknown = null;

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  scope = [scopeRow('m1', 'app'), scopeRow('m2', 'knowledge'), scopeRow('m3', 'personal'), scopeRow('m4', 'private'), scopeRow('m5', 'system'), scopeRow('m6', 'group', ['INHERITED_BASE'])];
  members = [member('u1', 'Ada'), member('u2', 'Bob')];
  createError = null;
  request.mockImplementation(async (q: string) => {
    if (q === APP_MEMORY_SCOPE_QUERY) return { appMemoryScope: { items: scope, total: scope.length } };
    if (q === TEAM_ROSTER_QUERY) return { teamRoster: { workers: [] } };
    if (q === APP_PEOPLE_QUERY) return { app: { id: 'app-1', members } };
    if (q === CREATE_QUESTION_LOG_MUTATION) { if (createError) throw createError; return { createQuestionLog: { id: 'l1', urn: 'hrn:node:acme.com:m1:questions', name: 'Questions', prefix: 'D' } }; }
    throw new Error(`unexpected query ${q.slice(0, 40)}`);
  });
});

const creates = () => request.mock.calls.filter((c) => c[0] === CREATE_QUESTION_LOG_MUTATION);
async function submit(fields: Record<string, string | string[]>, locals: Record<string, unknown> = {}) {
  const { actions } = await import('./+page.server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return (actions as any).createQuestionLog({
    request: new Request('http://localhost/app/apps/app-1/questions', { method: 'POST', body }),
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1', name: 'Ada' }, impersonation: null, ...locals },
    url: new URL('http://localhost/app/apps/app-1/questions'),
  });
}
const outcome = async (p: Promise<unknown>): Promise<{ returned?: any; thrown?: any }> => p.then((v) => ({ returned: v as any }), (e) => ({ thrown: e as any }));

describe('what the action sends', () => {
  it('creates the log at loc "questions", named "Questions", with the chosen deciders and no prefix, then redirects to the tab', async () => {
    const r = await outcome(submit({ memoryId: 'm1', deciders: ['u1', 'u2'] }));
    expect(creates()).toHaveLength(1);
    expect(creates()[0][1]).toEqual({ memoryRef: 'm1', loc: 'questions', name: 'Questions', defaultDeciders: ['u1', 'u2'] });
    expect(r.thrown).toMatchObject({ status: 303, location: '/app/apps/app-1/questions' });
  });
});

describe('only what was offered is accepted (400, no create request)', () => {
  it.each([
    ['a memory that was not offered', { memoryId: 'm-other', deciders: ['u1'] }],
    ['a personal memory', { memoryId: 'm3', deciders: ['u1'] }],
    ['a private memory', { memoryId: 'm4', deciders: ['u1'] }],
    ['a system memory', { memoryId: 'm5', deciders: ['u1'] }],
    ['a memory the App only inherits from its base Agent', { memoryId: 'm6', deciders: ['u1'] }],
    ['no memory', { deciders: ['u1'] }],
    ['a decider that was not offered', { memoryId: 'm1', deciders: ['u1', 'u-stranger'] }],
    ['no decider at all', { memoryId: 'm1' }],
    ['the same decider twice', { memoryId: 'm1', deciders: ['u1', 'u1'] }],
  ])('refuses %s', async (_what, fields) => {
    const r = await outcome(submit(fields as Record<string, string | string[]>));
    expect(creates()).toHaveLength(0);
    expect(r.returned).toMatchObject({ status: 400 });
  });

  it('refuses more than twenty deciders', async () => {
    members = Array.from({ length: 25 }, (_, i) => member(`p${i}`, `P${i}`));
    const r = await outcome(submit({ memoryId: 'm1', deciders: Array.from({ length: 21 }, (_, i) => `p${i}`) }));
    expect(creates()).toHaveLength(0);
    expect(r.returned).toMatchObject({ status: 400 });
  });

  it('withheld members: only the viewer may be a decider', async () => {
    members = null;
    expect((await outcome(submit({ memoryId: 'm1', deciders: ['u2'] }))).returned).toMatchObject({ status: 400 });
    expect(creates()).toHaveLength(0);
    await outcome(submit({ memoryId: 'm1', deciders: ['u1'] }));
    expect(creates()[0][1]).toMatchObject({ defaultDeciders: ['u1'] });
  });
});

describe('the guards come first', () => {
  it('a missing token redirects to sign-in and reads nothing', async () => {
    const r = await outcome(submit({ memoryId: 'm1', deciders: ['u1'] }, { token: null }));
    expect(r.thrown).toMatchObject({ status: 303 });
    expect(request).not.toHaveBeenCalled();
  });
  it('under impersonation: 403 and no request of any kind', async () => {
    const r = await outcome(submit({ memoryId: 'm1', deciders: ['u1'] }, { impersonation: { by: 'staff' } }));
    expect(r.returned).toMatchObject({ status: 403 });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('typed refusals (known codes only)', () => {
  it.each([
    ['QUESTION_FORBIDDEN', 403, 'Only a manager of that memory or an owner of this App can set up questions.'],
    ['QUESTION_DECIDER_NOT_ELIGIBLE', 400, 'One of the people you chose cannot write that memory, so they cannot decide there. Give them write access first, or leave them out.'],
    ['QUESTION_LOG_EXISTS', 409, "That memory already has, or once had, a node at 'questions'. Choose another memory."],
    ['QUESTION_LOG_ENCRYPTED', 400, 'An encrypted memory cannot hold a question log.'],
    ['QUESTION_LOG_MIRRORED', 400, 'A memory mirrored from Git cannot hold a question log.'],
    ['QUESTION_LOG_SYSTEM_MEMORY', 400, 'That memory cannot hold a question log. Choose one of the App’s own memories.'],
    ['QUESTION_LOG_ANONYMOUS_MEMORY', 400, 'That memory cannot hold a question log. Choose one of the App’s own memories.'],
  ])('%s maps to %i and its own text', async (code, status, text) => {
    expect(questionLogRefusal(code)).toEqual({ status, text });
    createError = gqlError(code);
    const r = await outcome(submit({ memoryId: 'm1', deciders: ['u1'] }));
    expect(r.returned).toMatchObject({ status, data: { createLog: { error: text } } });
  });
  it('an unknown code is not mapped, and takes the generic text with status 500', async () => {
    expect(questionLogRefusal('SOMETHING_NEW')).toBeNull();
    createError = gqlError('SOMETHING_NEW');
    const r = await outcome(submit({ memoryId: 'm1', deciders: ['u1'] }));
    expect(r.returned).toMatchObject({ status: 500 });
    expect(r.returned.data.createLog.error).not.toContain('SOMETHING_NEW');
  });
});

describe('the choices the form offers', () => {
  it('memories: the App’s own, group and knowledge ones; not personal, private, system or inherited-only', () => {
    expect(setupMemoryChoices(scope as never)!.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
  it('an unavailable scope is null, not an empty list', () => expect(setupMemoryChoices(null)).toBeNull());
  it('deciders: the people, with the viewer first; withheld or failed members leave the viewer alone and fixed', () => {
    const viewer = { id: 'u1', name: 'Ada' };
    expect(setupDeciderChoices({ people: [{ id: 'u2', name: 'Bob', handle: 'bob' }, { id: 'u1', name: 'Ada', handle: 'ada' }], withheld: false, failed: false }, viewer))
      .toMatchObject({ fixed: false, people: [{ id: 'u1' }, { id: 'u2' }] });
    expect(setupDeciderChoices({ people: [], withheld: true, failed: false }, viewer)).toMatchObject({ fixed: true, people: [{ id: 'u1', name: 'Ada' }] });
    expect(setupDeciderChoices({ people: [], withheld: false, failed: true }, viewer)).toMatchObject({ fixed: true, people: [{ id: 'u1' }] });
  });
});
