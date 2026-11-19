/**
 * portal#2261 — the task detail page's first load reads only its first screen: the App, the task's facts,
 * its subtask tree and the breadcrumb's ancestors. Every other section reads when it is shown, through
 * the sections endpoint (sections.server.test.ts), so one page open no longer holds a dozen reads at once.
 *
 * Red on main: the loader ran loadHistory, loadReview, loadWriteCandidates, taskClonesPage, taskDependencies,
 * taskFindingsPage and MEMORIES_QUERY at load (one Promise.all of six, then the rest).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASK_ANCESTOR_QUERY,
  AGENT_TASK_DETAIL_QUERY,
  AGENT_TASK_TREE_QUERY,
  AGENT_TASKS_APP_QUERY,
} from '$lib/server/queries';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const task = {
  id: 't1', appId: 'app-1', parentTaskId: 'p1', title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: null, assignee: null, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: null, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: false, result: { outcome: 'SUCCESS', summary: 's', evidence: null },
  sessionEndRequest: null,
};

async function firstLoad(impersonation: unknown = null) {
  const { load } = await import('./[taskId]/+page.server');
  return (await load({
    params: { appId: 'app-1', taskId: 't1' },
    parent: async () => ({}),
    locals: { token: 'tok', user: { id: 'u1' }, impersonation },
    url: new URL('http://localhost/app/apps/app-1/tasks/t1'),
  } as never)) as Record<string, unknown>;
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
    if (q === AGENT_TASK_TREE_QUERY) return { agentTaskTree: [{ id: 't1', parentTaskId: 'p1', status: 'STARTED' }] };
    if (q === AGENT_TASK_ANCESTOR_QUERY) return { agentTask: { id: 'p1', handle: 'AT1', title: 'Parent', parentTaskId: null } };
    throw new Error('a deferred section read ran at first load');
  });
});

describe('task detail first screen (portal#2261)', () => {
  it('first load issues only the first screen’s reads', async () => {
    await firstLoad();
    expect(request.mock.calls.map((c) => c[0])).toEqual([
      AGENT_TASKS_APP_QUERY,
      AGENT_TASK_DETAIL_QUERY,
      AGENT_TASK_TREE_QUERY,
      AGENT_TASK_ANCESTOR_QUERY,
    ]);
  });

  it('hands back the facts, the tree and the breadcrumb, and none of the deferred sections', async () => {
    const r = await firstLoad();
    expect(r).toMatchObject({ task: { id: 't1' }, tree: { kind: 'ok' }, ancestors: [{ id: 'p1' }], canWrite: true });
    for (const deferred of ['history', 'review', 'clones', 'dependencies', 'findings', 'candidates', 'roles', 'families', 'nodeMemories']) {
      expect(r).not.toHaveProperty(deferred);
    }
  });

  it('an impersonation session reads the same first screen and offers no writes', async () => {
    const r = await firstLoad({ id: 'admin' });
    expect(r).toMatchObject({ canWrite: false });
    expect(request).toHaveBeenCalledTimes(4);
  });
});
