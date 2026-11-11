/**
 * portal#1052 — the board's and the task page's loaders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ALARMS_QUERY, AGENT_TASK_DETAIL_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_TREE_QUERY, AGENT_TASKS_APP_QUERY, PULL_REQUEST_READINESS_QUERY, TASK_REVIEW_EVENTS_QUERY, AGENT_TASKS_BOARD_QUERY, AGENT_TASK_REF_QUERY, TASK_DEPENDENCIES_QUERY, TEAM_COMPOSITION_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { markStreamHandled } from '$lib/mark-stream-handled';
import { selectsFieldPath } from '$lib/test/graphql-selection';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function loadBoard(search = '') {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/tasks${search}`),
  } as never)) as Record<string, unknown>;
}

describe('board loader', () => {
  it('reads the board with the URL’s filter, defaulting to active', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    const r = await loadBoard();
    expect(r.filter).toBe('active');
    expect(request).toHaveBeenCalledWith(AGENT_TASKS_BOARD_QUERY, expect.objectContaining({ appRef: 'app-1', status: ['PENDING', 'STARTED'] }));
    await loadBoard('?status=queued');
    expect(request).toHaveBeenLastCalledWith(AGENT_TASKS_BOARD_QUERY, expect.objectContaining({ queued: true }));
  });

  // portal#1427
  it('reads overdue and tags from the URL and sends only those', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    const r = await loadBoard('?status=all&overdue=1&tags=ops,infra');
    expect(r).toMatchObject({ overdue: true, tags: ['ops', 'infra'], overdueDropped: false });
    expect(request).toHaveBeenLastCalledWith(AGENT_TASKS_BOARD_QUERY, expect.objectContaining({ overdue: true, tagsAll: ['ops', 'infra'] }));
  });

  it('sends neither argument when the URL sets neither', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    await loadBoard();
    const vars = request.mock.calls.find((c) => c[0] === AGENT_TASKS_BOARD_QUERY)![1];
    expect(vars).not.toHaveProperty('overdue');
    expect(vars).not.toHaveProperty('tagsAll');
  });

  it('Overdue with Ended or Backlog is dropped, not sent, and the page is told', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    for (const status of ['ended', 'backlog']) {
      request.mockClear();
      const r = await loadBoard(`?status=${status}&overdue=1`);
      expect(r).toMatchObject({ overdue: false, overdueDropped: true });
      expect(request.mock.calls.find((c) => c[0] === AGENT_TASKS_BOARD_QUERY)![1]).not.toHaveProperty('overdue');
    }
  });

  it('a blank tags value is canonicalized away, like blank text', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    await expect(loadBoard('?status=all&tags=%20,')).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/tasks?status=all' });
  });

  it('a missing App is a 404', async () => {
    request.mockResolvedValueOnce({ app: null });
    await expect(loadBoard()).rejects.toMatchObject({ status: 404 });
  });

  // Uma's P2-2 on #1127: a viewer with no access to the App gets the App
  // page's 404, not a 500. The App page salvages a GraphQL refusal of
  // app(ref:) the same way; a transport failure still throws.
  it('a refused App read (FORBIDDEN) is a 404, not a 500', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(loadBoard()).rejects.toMatchObject({ status: 404 });
  });

  // Atilla's P2 on #1127: only the access and missing codes become a 404. A
  // server fault that happens to carry a GraphQL response stays a failure.
  it('a NOT_FOUND App read is a 404 too', async () => {
    request.mockRejectedValueOnce(gqlError('NOT_FOUND'));
    await expect(loadBoard()).rejects.toMatchObject({ status: 404 });
  });

  it('an INTERNAL_SERVER_ERROR with app:null is a failure, not a 404', async () => {
    request.mockRejectedValueOnce({ response: { data: { app: null }, errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    await expect(loadBoard()).rejects.not.toMatchObject({ status: 404 });
  });

  it('an HTTP 500 with no data is a failure, not a 404', async () => {
    request.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(loadBoard()).rejects.not.toMatchObject({ status: 404 });
  });

  it('a transport failure on the App read is not dressed up as a 404', async () => {
    request.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(loadBoard()).rejects.toThrow('ECONNREFUSED');
  });

  it('a non-participant gets the inline state, not an error page', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw gqlError('APP_NOT_FOUND');
    });
    expect((await loadBoard()).board).toEqual({ kind: 'not-participant' });
  });
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: { id: 'u1', kind: 'USER', name: 'Holger', urn: null }, assignee: null, startBy: null,
  createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [], description: null, requirements: null, createdBy: null,
  createdByRunId: null, assignedAt: null, assignedBy: null, startedAt: null, finishedAt: null, cancelledAt: null,
  closeSessionWhenDone: false, result: null, sessionEndRequest: null, ...over,
});

async function loadDetail(taskId = 't1') {
  const { load } = await import('./[taskId]/+page.server');
  const r = (await load({
    params: { appId: 'app-1', taskId },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    // portal#1090: the loader reads ?created=1 from the URL.
    url: new URL('http://localhost/app/apps/app-1/tasks/t1'),
  } as never)) as Record<string, unknown>;
  // Amended for portal#1585: the memories stream now REJECTS through to the
  // picker's stage instead of the loader swallowing it to [], and per-test
  // mocks here do not answer MEMORIES_QUERY (these tests exercise the other
  // reads). Mark the streamed rejection handled so it cannot fail the run
  // as an unhandled error; the memories-failure behaviour itself is pinned
  // in node-memories-failure.server.test.ts.
  markStreamHandled(r.nodeMemories as Promise<unknown>);
  return r;
}

describe('views (slice 2)', () => {
  const answer = async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === TEAM_COMPOSITION_QUERY) return { teamComposition: { appId: 'app-1', asOf: '2026-10-16T00:00:00Z', lanes: [] } };
    if (q === TEAM_ROSTER_QUERY) return { teamRoster: { asOf: '2026-10-16T00:00:00Z', workers: [{ startedTasks: ['t1'], pendingTasks: [], waitingOn: [], unreactedChildTask: null, alarms: [] }] } };
    if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: 't1', appId: 'app-1', handle: 'AT3', title: 'Ship it' } };
    if (q === AGENT_ALARMS_QUERY) return { agentTeamEvents: [] };
    if (q === AGENT_TASKS_BOARD_QUERY) return { agentTasks: [] };
    throw new Error('unexpected');
  };

  it('reads only the view on screen: the roster, with titles, and no board', async () => {
    request.mockImplementation(answer);
    const r = await loadBoard('?view=roster');
    expect(r.view).toBe('roster');
    expect(r.roster).toMatchObject({ kind: 'ok' });
    expect(r.refs).toEqual({ t1: { id: 't1', handle: 'AT3', title: 'Ship it' } });
    expect(r.board).toBeNull();
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASKS_BOARD_QUERY);
  });

  // portal#1327: composition.test.ts hands `data` straight to the page, so it
  // cannot see the loader's branch. Pin it here: ?view=composition reads the
  // composition and nothing else of the views.
  it('the composition view reads the composition only: no board, roster, alarms or titles', async () => {
    request.mockImplementation(answer);
    const r = await loadBoard('?view=composition');
    expect(r.view).toBe('composition');
    expect(r.composition).toEqual({ kind: 'ok', value: { appId: 'app-1', asOf: '2026-10-16T00:00:00Z', lanes: [] } });
    expect(r.board).toBeNull();
    expect(r.roster).toBeNull();
    expect(r.alarms).toBeNull();
    expect(r.refs).toEqual({});
    expect(request).toHaveBeenCalledWith(TEAM_COMPOSITION_QUERY, { appRef: 'app-1' });
    const asked = request.mock.calls.map((c) => c[0]);
    for (const other of [AGENT_TASKS_BOARD_QUERY, TEAM_ROSTER_QUERY, AGENT_ALARMS_QUERY, AGENT_TASK_REF_QUERY]) expect(asked).not.toContain(other);
  });

  it('a failed composition read reaches the page as failed, not as an empty team or a thrown load', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw new Error('ECONNRESET');
    });
    const r = await loadBoard('?view=composition');
    expect(r.composition).toEqual({ kind: 'failed' });
  });

  it('the other views carry no composition', async () => {
    request.mockImplementation(answer);
    expect((await loadBoard('?view=roster')).composition).toBeNull();
    expect((await loadBoard()).composition).toBeNull();
  });

  it('the alarms view reads alarms, defaulting the filter to open', async () => {
    request.mockImplementation(answer);
    const r = await loadBoard('?view=alarms');
    expect(r.alarms).toMatchObject({ kind: 'ok' });
    expect(r.alarmFilter).toBe('open');
    expect(request.mock.calls.map((c) => c[0])).not.toContain(TEAM_ROSTER_QUERY);
  });

  it('an unknown view falls back to the board', async () => {
    request.mockImplementation(answer);
    expect((await loadBoard('?view=bogus')).view).toBe('board');
  });
});

describe('task loader', () => {
  it('a null task is a 404 that doesn’t say which of missing or unreadable', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTask: null }));
    await expect(loadDetail()).rejects.toMatchObject({ status: 404, body: { message: 'Task not found, or you can’t see it' } });
  });

  it('a refused App read is a 404 on the task page too', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) throw gqlError('FORBIDDEN');
      return { agentTask: null };
    });
    await expect(loadDetail()).rejects.toMatchObject({ status: 404 });
  });

  it('a task of another App redirects to its own URL', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTask: detail({ appId: 'app-2' }) }));
    await expect(loadDetail()).rejects.toMatchObject({ status: 303, location: '/app/apps/app-2/tasks/t1' });
  });

  it('portal#1340: the detail read selects properties and the loader hands back the task’s own value', async () => {
    const own = { review: { local: false }, n: 0, s: '' };
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: detail({ properties: own }) };
      if (q === AGENT_TASK_TREE_QUERY) return { agentTaskTree: [detail()] };
      if (q === AGENT_TASK_EVENTS_QUERY) return { agentTeamEvents: [] };
      return { agentTask: null };
    });
    const r = await loadDetail();
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', ['agentTask', 'properties'])).toBe(true);
    expect(request).toHaveBeenCalledWith(AGENT_TASK_DETAIL_QUERY, expect.anything());
    expect((r.task as { properties: unknown }).properties).toEqual(own);
  });

  it('portal#1340: a failed task read is a failure, never an empty Properties result', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw new Error('down');
    });
    await expect(loadDetail()).rejects.toThrow('down');
  });

  it('a failed history leaves the facts and the tree in place', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: detail() };
      if (q === AGENT_TASK_TREE_QUERY) return { agentTaskTree: [detail()] };
      if (q === AGENT_TASK_EVENTS_QUERY) throw new Error('down');
      throw new Error(`unexpected ${q.slice(0, 40)}`);
    });
    const r = await loadDetail();
    expect(r.task).toMatchObject({ id: 't1' });
    expect(r.tree).toMatchObject({ kind: 'ok' });
    expect(r.history).toEqual({ kind: 'failed' });
  });
});

// portal#1349: handles in the URL.
describe('task loader: handles', () => {
  const asked = (q: string, withTask: unknown) => (q === AGENT_TASKS_APP_QUERY ? { app } : q === AGENT_TASK_DETAIL_QUERY ? { agentTask: withTask } : { agentTask: null });

  it('a bare handle is qualified with THIS route’s App and forwarded to the server resolver', async () => {
    request.mockImplementation(async (q: string) => asked(q, detail({ handle: 'AT3.405' })));
    const r = await loadDetail('AT3.405');
    expect(request).toHaveBeenCalledWith(AGENT_TASK_DETAIL_QUERY, { id: 'hrn:agenttask:acme.com:team:AT3.405' });
    expect(r.task).toMatchObject({ id: 't1', handle: 'AT3.405' });
  });

  it('loads initial relations by resolved canonical id, never the raw handle', async () => {
    const page = { items: [], hasMore: false };
    request.mockImplementation(async (q: string) => {
      if (q === TASK_DEPENDENCIES_QUERY) return { agentTask: { id: 't1', appId: app.id, blockedBy: page, blocks: page } };
      return asked(q, detail({ handle: 'AT3.405' }));
    });
    const r = await loadDetail('AT3.405');
    expect(request).toHaveBeenCalledWith(AGENT_TASK_DETAIL_QUERY, { id: 'hrn:agenttask:acme.com:team:AT3.405' });
    expect(request).toHaveBeenCalledWith(TASK_DEPENDENCIES_QUERY, { id: 't1', offset: 0 });
    expect(r.dependencies).toEqual({ kind: 'ok', value: { blockedBy: page, blocks: page } });
  });

  it('a raw id is forwarded unchanged (bookmarks keep working)', async () => {
    request.mockImplementation(async (q: string) => asked(q, detail()));
    await loadDetail('t1');
    expect(request).toHaveBeenCalledWith(AGENT_TASK_DETAIL_QUERY, { id: 't1' });
  });

  it('another App’s qualified handle is a 404 BEFORE any task read — no redirect, same words as unknown', async () => {
    request.mockImplementation(async (q: string) => asked(q, detail({ appId: 'app-2' })));
    await expect(loadDetail('hrn:agenttask:acme.com:other:AT3')).rejects.toMatchObject({ status: 404, body: { message: 'Task not found, or you can’t see it' } });
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASK_DETAIL_QUERY);
  });

  it('this App’s qualified handle is forwarded as written', async () => {
    request.mockImplementation(async (q: string) => asked(q, detail({ handle: 'AT3' })));
    await loadDetail('hrn:agenttask:acme.com:team:AT3');
    expect(request).toHaveBeenCalledWith(AGENT_TASK_DETAIL_QUERY, { id: 'hrn:agenttask:acme.com:team:AT3' });
  });

  it('an unknown, malformed or unreadable handle answers exactly like an unknown id', async () => {
    request.mockImplementation(async (q: string) => asked(q, null));
    const answers = [];
    for (const seg of ['AT999', 'AT3..1', 'no-such-id']) {
      answers.push(await loadDetail(seg).then(() => null, (e) => ({ status: e.status, body: e.body })));
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 404, body: { message: 'Task not found, or you can’t see it' } });
  });

  it('a raw id of another App keeps its authorized redirect, and the URL segment is encoded', async () => {
    request.mockImplementation(async (q: string) => asked(q, detail({ appId: 'app-2', id: 'a b' })));
    await expect(loadDetail('t1')).rejects.toMatchObject({ status: 303, location: '/app/apps/app-2/tasks/a%20b' });
  });

  it('the viewer is checked against the App first: a refused App never reaches the task read', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) throw gqlError('FORBIDDEN');
      return asked(q, detail());
    });
    await expect(loadDetail('AT3')).rejects.toMatchObject({ status: 404, body: { message: 'App not found' } });
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASK_DETAIL_QUERY);
  });
});

describe('task loader: Review section (portal#1697)', () => {
  const H = 'a'.repeat(40);
  const readiness = { ready: false, head: H, slots: [] };
  const mock = (read: () => unknown) =>
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: detail({ handle: 'AT3.405' }) };
      if (q === AGENT_TASK_TREE_QUERY) return { agentTaskTree: [detail()] };
      if (q === AGENT_TASK_EVENTS_QUERY) return { agentTeamEvents: [] };
      if (q === TASK_REVIEW_EVENTS_QUERY) return { agentTeamEvents: [{ id: 'e1', type: 'pr.frozen', payload: { head: H } }] };
      if (q === PULL_REQUEST_READINESS_QUERY) return read();
      return { agentTask: null };
    });

  it('asks readiness once per load, by the canonical id, and hands back the answer', async () => {
    mock(() => ({ pullRequestReadiness: readiness }));
    const r = await loadDetail('AT3.405');
    expect(r.review).toEqual({ kind: 'ok', value: { readiness, seat: null } });
    expect(request.mock.calls.filter((c) => c[0] === PULL_REQUEST_READINESS_QUERY)).toEqual([[PULL_REQUEST_READINESS_QUERY, { taskRef: 't1', head: H }]]);
  });

  it('a refused read costs the section, not the page', async () => {
    mock(() => { throw gqlError('INTERNAL'); });
    const r = await loadDetail();
    expect(r.review).toEqual({ kind: 'failed' });
    expect(r.task).toMatchObject({ id: 't1' });
  });
});

// #1935: constant-size cursors avoid growing a URL with every visited page.
it('1935 continues one direction only and exposes links without a growing trail', async () => {
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === AGENT_ALARMS_QUERY) return { agentTeamEvents: Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, taskId: null })) };
    throw new Error('unexpected request');
  });
  const r = await loadBoard('?view=alarms&alarms=all&alarmBefore=second');
  expect(request).toHaveBeenCalledWith(AGENT_ALARMS_QUERY, { appRef: 'app-1', before: 'second', after: undefined, newestFirst: true, limit: 21 });
  expect(r.alarmPaging).toEqual({
    previousHref: '/app/apps/app-1/tasks?view=alarms&alarms=all&alarmAfter=a0',
    nextHref: '/app/apps/app-1/tasks?view=alarms&alarms=all&alarmBefore=a19' });
  const first = await loadBoard('?view=alarms');
  expect(first.alarmPaging).toMatchObject({ previousHref: null });
  await expect(loadBoard('?view=alarms&alarmBefore=x&alarmAfter=y')).rejects.toMatchObject({ status: 400 });
});
