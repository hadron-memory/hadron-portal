/**
 * portal#1052 — the board's and the task page's loaders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ALARMS_QUERY, AGENT_TASK_DETAIL_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_TREE_QUERY, AGENT_TASKS_APP_QUERY, AGENT_TASKS_BOARD_QUERY, AGENT_TASKS_OPEN_TITLES_QUERY, TEAM_COMPOSITION_QUERY, TEAM_ROSTER_QUERY } from '$lib/server/queries';

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

  // portal#1400: the board's text search is the URL's `text`, sent to the server before its cap.
  describe('text search', () => {
    const boardArgs = () => request.mock.calls.find((c) => c[0] === AGENT_TASKS_BOARD_QUERY)?.[1] as Record<string, unknown>;
    beforeEach(() => {
      request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
    });

    it('sends the trimmed text beside the status filter, and returns it for the field', async () => {
      const r = await loadBoard('?status=ended&text=%20deploy%20');
      expect(boardArgs()).toMatchObject({ status: ['FINISHED', 'CANCELLED'], text: 'deploy' });
      expect(r.text).toBe('deploy');
    });

    it('blank text is omitted: no text key is sent and the field is empty', async () => {
      const r = await loadBoard('?text=%20%20');
      expect(Object.keys(boardArgs())).not.toContain('text');
      expect(r.text).toBe('');
    });

    it('sends percent, underscore and backslash exactly as typed, once', async () => {
      await loadBoard(`?text=${encodeURIComponent('50%_\\done')}`);
      expect(boardArgs().text).toBe('50%_\\done');
    });

    it('accepts 200 code units, and an astral pair that makes 201 reaches the server whole (never truncated)', async () => {
      const ok = '😀'.repeat(100);
      await loadBoard(`?text=${encodeURIComponent(ok)}`);
      expect(boardArgs().text).toBe(ok);
      request.mockClear();
      const over = 'a'.repeat(199) + '😀';
      expect(over).toHaveLength(201);
      await loadBoard(`?text=${encodeURIComponent(over)}`);
      expect(boardArgs().text).toBe(over);
    });

    it('an overlong text the server refuses is bad-text, not no matches and not a failure', async () => {
      request.mockImplementation(async (q: string) => {
        if (q === AGENT_TASKS_APP_QUERY) return { app };
        throw gqlError('BAD_USER_INPUT');
      });
      const r = await loadBoard(`?text=${'a'.repeat(201)}`);
      expect(r.board).toEqual({ kind: 'bad-text' });
      expect(r.text).toBe('a'.repeat(201));
    });

    it('APP_NOT_FOUND and a read failure stay distinct from no matches while searching', async () => {
      request.mockImplementation(async (q: string) => {
        if (q === AGENT_TASKS_APP_QUERY) return { app };
        throw gqlError('APP_NOT_FOUND');
      });
      expect((await loadBoard('?text=x')).board).toEqual({ kind: 'not-participant' });
      request.mockImplementation(async (q: string) => {
        if (q === AGENT_TASKS_APP_QUERY) return { app };
        throw new Error('boom');
      });
      expect((await loadBoard('?text=x')).board).toEqual({ kind: 'failed' });
      request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [] }));
      expect((await loadBoard('?text=x')).board).toMatchObject({ kind: 'ok', value: { tasks: [] } });
    });

    it('other views never send text', async () => {
      request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : q === AGENT_TASKS_OPEN_TITLES_QUERY ? { agentTasks: [] } : { teamRoster: { items: [] } }));
      await loadBoard('?view=roster&text=x');
      expect(request.mock.calls.filter((c) => c[0] === AGENT_TASKS_BOARD_QUERY)).toHaveLength(0);
    });

    it('each load is its own read: a second search does not reuse the first’s result', async () => {
      request.mockImplementation(async (q: string, v: { text?: string }) => (q === AGENT_TASKS_APP_QUERY ? { app } : { agentTasks: [{ id: `for-${v.text ?? 'none'}` }] }));
      const a = (await loadBoard('?text=one')).board as { value: { tasks: { id: string }[] } };
      const b = (await loadBoard('?text=two')).board as { value: { tasks: { id: string }[] } };
      expect(a.value.tasks[0].id).toBe('for-one');
      expect(b.value.tasks[0].id).toBe('for-two');
    });
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
    if (q === TEAM_COMPOSITION_QUERY) return { teamComposition: { appId: 'app-1', asOf: '2026-10-16T00:00:00Z', lanes: [] } };
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
    expect(r.titles).toEqual({});
    expect(request).toHaveBeenCalledWith(TEAM_COMPOSITION_QUERY, { appRef: 'app-1' });
    const asked = request.mock.calls.map((c) => c[0]);
    for (const other of [AGENT_TASKS_BOARD_QUERY, TEAM_ROSTER_QUERY, AGENT_ALARMS_QUERY, AGENT_TASKS_OPEN_TITLES_QUERY]) expect(asked).not.toContain(other);
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
