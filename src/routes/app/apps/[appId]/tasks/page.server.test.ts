/**
 * portal#1052 — the board's and the task page's loaders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ALARMS_QUERY, AGENT_TASK_DETAIL_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_TREE_QUERY, AGENT_TASKS_APP_QUERY, AGENT_TASKS_BOARD_QUERY, AGENT_TASKS_OPEN_TITLES_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';

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

async function loadDetail() {
  const { load } = await import('./[taskId]/+page.server');
  return (await load({
    params: { appId: 'app-1', taskId: 't1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    // portal#1090: the loader reads ?created=1 from the URL.
    url: new URL('http://localhost/app/apps/app-1/tasks/t1'),
  } as never)) as Record<string, unknown>;
}

describe('views (slice 2)', () => {
  const answer = async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === TEAM_ROSTER_QUERY) return { teamRoster: { asOf: '2026-10-16T00:00:00Z', workers: [] } };
    if (q === AGENT_TASKS_OPEN_TITLES_QUERY) return { agentTasks: [{ id: 't1', title: 'Ship it' }] };
    if (q === AGENT_ALARMS_QUERY) return { agentTeamEvents: [] };
    if (q === AGENT_TASKS_BOARD_QUERY) return { agentTasks: [] };
    throw new Error('unexpected');
  };

  it('reads only the view on screen: the roster, with titles, and no board', async () => {
    request.mockImplementation(answer);
    const r = await loadBoard('?view=roster');
    expect(r.view).toBe('roster');
    expect(r.roster).toMatchObject({ kind: 'ok' });
    expect(r.titles).toEqual({ t1: 'Ship it' });
    expect(r.board).toBeNull();
    expect(request.mock.calls.map((c) => c[0])).not.toContain(AGENT_TASKS_BOARD_QUERY);
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
