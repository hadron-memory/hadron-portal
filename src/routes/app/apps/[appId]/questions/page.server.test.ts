/**
 * portal#2235 — the App's Questions loader. Every filter is a server argument (hrn:node:hadronmemory.com:specs:cor:dmo:140:09), a malformed URL value is
 * canonicalised by a 303, and a failed read is a failure, never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASKS_APP_QUERY,
  APP_PEOPLE_QUERY,
  APP_QUESTIONS_QUERY,
  APP_QUESTION_LOGS_QUERY,
  TEAM_ROSTER_QUERY,
} from '$lib/server/queries';
import { APP_MEMORY_SCOPE_QUERY } from '../app-memories';
import { selectsFieldPath } from '$lib/test/graphql-selection';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });
const member = (id: string, name: string) => ({ user: { id, handle: name.toLowerCase(), name } });
type Over = Partial<{ questions: unknown; logs: unknown; members: unknown; appError: unknown; questionsError: unknown; logsError: unknown; scope: unknown; scopeError: unknown }>;

function serve(over: Over = {}) {
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) { if (over.appError) throw over.appError; return { app }; }
    if (q === APP_QUESTIONS_QUERY) { if (over.questionsError) throw over.questionsError; return { questions: over.questions ?? { total: 0, items: [] } }; }
    if (q === APP_QUESTION_LOGS_QUERY) { if (over.logsError) throw over.logsError; return { questionLogs: over.logs ?? [{ id: 'l1', urn: 'hrn:node:acme.com:team:questions', name: 'Questions', memoryId: 'm1', prefix: 'Q' }] }; }
    if (q === APP_MEMORY_SCOPE_QUERY) { if (over.scopeError) throw over.scopeError; return { appMemoryScope: { items: over.scope ?? [{ memoryId: 'm1', memoryUrn: 'hrn:mem:acme.com:m1', name: 'Team notes', class: 'app', viewerCanWrite: true, sources: [{ kind: 'APP_MEMORY', agentId: null }] }], total: 1 } }; }
    if (q === TEAM_ROSTER_QUERY) return { teamRoster: { workers: [] } };
    if (q === APP_PEOPLE_QUERY) return { app: { id: 'app-1', members: over.members === undefined ? [member('u1', 'Ada'), member('u2', 'Bob')] : over.members } };
    throw new Error(`unexpected query ${q.slice(0, 40)}`);
  });
}

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function loadPage(search = '') {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    parent: async () => ({}),
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/questions${search}`),
  } as never)) as Record<string, any>;
}
const questionsVars = () => request.mock.calls.filter((c) => c[0] === APP_QUESTIONS_QUERY).at(-1)![1];

describe('what the loader asks the server', () => {
  it('default URL: pending, mine and unassigned, by priority, first page, no priority key', async () => {
    serve();
    await loadPage();
    expect(questionsVars()).toEqual({ appRef: 'app-1', answered: false, assigneeId: 'u1', unassigned: true, sort: 'PRIORITY_DESC', limit: 50, offset: 0 });
    expect(questionsVars()).not.toHaveProperty('priority');
  });

  it('?status=answered&assignee=all&sort=newest&priority=high,urgent&offset=50 sends exactly those and no assignee keys', async () => {
    serve();
    await loadPage('?status=answered&assignee=all&sort=newest&priority=high,urgent&offset=50');
    expect(questionsVars()).toEqual({ appRef: 'app-1', answered: true, sort: 'ASKED_AT_DESC', priority: ['HIGH', 'URGENT'], offset: 50, limit: 50 });
  });

  it('another member’s id is sent as assigneeId, without unassigned', async () => {
    serve();
    await loadPage('?assignee=u2');
    const vars = questionsVars();
    expect(vars.assigneeId).toBe('u2');
    expect(vars).not.toHaveProperty('unassigned');
  });

  it('status=all sends no answered key', async () => {
    serve();
    await loadPage('?status=all');
    expect(questionsVars()).not.toHaveProperty('answered');
  });
});

describe('canonical URLs', () => {
  it('a malformed status redirects 303 to the URL without it', async () => {
    serve();
    await expect(loadPage('?status=bogus&sort=newest')).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/questions?sort=newest' });
  });
  it('a malformed offset and priority are dropped too', async () => {
    serve();
    await expect(loadPage('?offset=-1&priority=extreme')).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/questions' });
  });
  it('redirects only after the layout has run, so the active-org cookie is written first', async () => {
    serve();
    const { load } = await import('./+page.server');
    let parentRan = false;
    await expect(load({
      params: { appId: 'app-1' }, parent: async () => { parentRan = true; return {}; },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation: null }, url: new URL('http://localhost/x?status=bogus'),
    } as never)).rejects.toMatchObject({ status: 303 });
    expect(parentRan).toBe(true);
  });
});

describe('failure is not emptiness', () => {
  it('a failed questions read is { kind: "failed" }, never an empty list', async () => {
    serve({ questionsError: new Error('boom') });
    const r = await loadPage();
    expect(r.questions).toEqual({ kind: 'failed' });
  });
  it('APP_NOT_FOUND on the questions read is the same not-found treatment as the tasks page', async () => {
    serve({ questionsError: gqlError('APP_NOT_FOUND') });
    expect((await loadPage()).questions).toEqual({ kind: 'not-participant' });
  });
  it('a concealed App header (NOT_FOUND, as loadTasksApp maps it) is a 404', async () => {
    serve({ appError: gqlError('NOT_FOUND') });
    await expect(loadPage()).rejects.toMatchObject({ status: 404 });
  });
  it('a missing App is a 404 and nothing else is read', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app: null } : (() => { throw new Error('read after a missing App'); })()));
    await expect(loadPage()).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('a failed log read says failed for the logs, not "no log"', async () => {
    serve({ logsError: new Error('boom') });
    expect((await loadPage()).logs).toEqual({ kind: 'failed' });
  });
});

describe('the question logs (read on every page, for the log lines)', () => {
  it('a page with rows reads them too: the list shows who decides above its rows', async () => {
    serve({ questions: { total: 1, items: [{ id: 'q1' }] } });
    const r = await loadPage();
    expect(r.logs).toMatchObject({ kind: 'ok' });
    expect(request.mock.calls.some((c) => c[0] === APP_QUESTION_LOGS_QUERY)).toBe(true);
  });
  it('an App with no log reports an empty list', async () => {
    serve({ logs: [] });
    expect((await loadPage()).logs).toEqual({ kind: 'ok', value: [] });
  });
  it('a failed logs read is a failure for the logs only: the questions still load', async () => {
    serve({ logsError: new Error('boom'), questions: { total: 1, items: [{ id: 'q1' }] } });
    const r = await loadPage();
    expect(r.logs).toEqual({ kind: 'failed' });
    expect(r.questions).toMatchObject({ kind: 'ok' });
  });
});

describe('the setup form’s data (only when there is no log)', () => {
  it('no log: the memories it may offer, the deciders and the viewer', async () => {
    serve({ logs: [] });
    const r = await loadPage();
    expect(r.setup).toMatchObject({ memories: [{ id: 'm1', name: 'Team notes' }], deciders: { fixed: false, people: [{ id: 'u1' }, { id: 'u2' }] }, viewer: { id: 'u1' } });
  });
  it('a log exists: no setup data, and the memory scope is not read', async () => {
    serve();
    const r = await loadPage();
    expect(r.setup).toBeNull();
    expect(request.mock.calls.some((c) => c[0] === APP_MEMORY_SCOPE_QUERY)).toBe(false);
  });
  it('an unavailable memory scope is memories: null, never an empty list', async () => {
    serve({ logs: [], scopeError: new Error('boom') });
    expect((await loadPage()).setup.memories).toBeNull();
  });
  it('withheld members: only the viewer, fixed', async () => {
    serve({ logs: [], members: null });
    expect((await loadPage()).setup.deciders).toMatchObject({ fixed: true, people: [{ id: 'u1' }] });
  });
});

describe('the assignee choices', () => {
  it('offers the App’s people', async () => {
    serve();
    expect((await loadPage()).people).toMatchObject({ withheld: false, failed: false, people: [{ id: 'u1' }, { id: 'u2' }] });
  });
  it('withheld members (members: null) are reported as withheld, not as an empty App', async () => {
    serve({ members: null });
    expect((await loadPage()).people).toMatchObject({ withheld: true, people: [] });
  });
});

describe('the selection set', () => {
  it('pins the fields the page reads', () => {
    expect(selectsFieldPath(APP_QUESTION_LOGS_QUERY, 'AppQuestionLogs', ['questionLogs', 'defaultDeciders', 'name'])).toBe(true);
    expect(selectsFieldPath(APP_QUESTION_LOGS_QUERY, 'AppQuestionLogs', ['questionLogs', 'portalUrl'])).toBe(true);
    for (const path of ['questions.total', 'questions.items.portalUrl', 'questions.items.effectiveAssignee.name', 'questions.items.askedBy.worker.urn', 'questions.items.answer.key']) {
      expect(selectsFieldPath(APP_QUESTIONS_QUERY, 'AppQuestions', path.split('.')), path).toBe(true);
    }
    expect(selectsFieldPath(APP_QUESTION_LOGS_QUERY, 'AppQuestionLogs', ['questionLogs', 'id'])).toBe(true);
  });
});
