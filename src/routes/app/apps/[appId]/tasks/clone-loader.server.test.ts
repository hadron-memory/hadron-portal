/**
 * portal#2161 — the New task page's clone-mode load (`?from=`): the pre-fill
 * shows what the copy will actually get, never a value the server won't copy.
 * The parent is the rule's crux (hrn:node:hadronmemory.com:specs:cor:agt:050:02,
 * acceptance 4): the source's own parent only while it is readable, not AT0 and
 * not ended — otherwise "No project" (the copy lands under AT0), and a root
 * source pre-fills as a project. A cross-App source moves to its own App's
 * clone URL; an unknown one is the neutral 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_CLONE_PARENT_QUERY, AGENT_TASK_DETAIL_QUERY, MEMORIES_QUERY } from '$lib/server/queries';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const emptyCandidates = { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] };

const source = (over: Record<string, unknown> = {}) => ({
  id: 'src-1', appId: 'app-1', handle: 'AT3.2', title: 'Ship it', status: 'PENDING',
  parentTaskId: 'parent-1', description: 'The plan', source: 'http://x', tags: ['a', 'b'],
  closeSessionWhenDone: true, priority: 2,
  references: [{ kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT1', label: 'First' }],
  requirements: { role: 'portal-engineer', familyIn: ['claude'], familyNotIn: null, excludeWorkerIds: ['w9'], minTier: 'mid' },
  ...over,
});

let src: Record<string, unknown> | null = source();
let parent: Record<string, unknown> | null = { id: 'parent-1', handle: 'AT3', title: 'Build', status: 'PENDING' };
const request = vi.fn(async (q: string, v?: unknown) => {
  if (q === AGENT_TASK_DETAIL_QUERY) {
    // Only the source resolves; anything else (an unknown `from`) answers null.
    return { agentTask: (v as { id: string }).id === 'src-1' ? src : null };
  }
  if (q === AGENT_TASK_CLONE_PARENT_QUERY) return { agentTask: parent };
  if (q === MEMORIES_QUERY) return { memories: { items: [], hasMore: false } };
  return {};
});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: async () => app,
  loadWriteCandidates: async () => emptyCandidates,
}));

beforeEach(() => {
  request.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  src = source();
  parent = { id: 'parent-1', handle: 'AT3', title: 'Build', status: 'PENDING' };
});

const locals = { token: 't', user: { id: 'u1', name: 'U' }, impersonation: undefined };
async function loadFrom(from: string | null) {
  const { load } = await import('./new/+page.server');
  const url = new URL(from ? `https://x/tasks/new?from=${encodeURIComponent(from)}` : 'https://x/tasks/new');
  try {
    return { ret: (await load({ params: { appId: 'app-1' }, locals, url, parent: async () => ({}) } as never)) as Record<string, any> };
  } catch (e) {
    return { thrown: e as { status?: number; location?: string; body?: { message?: string } } };
  }
}

describe('clone load: the pre-filled parent (acceptance 4)', () => {
  it('a live parent is kept, named with its task', async () => {
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.parent).toEqual({ choice: 'parent:parent-1', task: { id: 'parent-1', handle: 'AT3', title: 'Build' } });
  });

  it.each(['FINISHED', 'CANCELLED'] as const)('a %s parent pre-fills "No project", not the ended parent', async (status) => {
    parent = { id: 'parent-1', handle: 'AT3', title: 'Build', status };
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.parent).toEqual({ choice: 'none', task: null });
  });

  it('an AT0 parent pre-fills "No project"', async () => {
    parent = { id: 'parent-1', handle: 'AT0', title: 'No project', status: 'PENDING' };
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.parent).toEqual({ choice: 'none', task: null });
  });

  it('an unreadable parent stays named but opaque', async () => {
    parent = null;
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.parent).toEqual({ choice: 'parent:parent-1', task: null });
  });

  it('a root source pre-fills as a project', async () => {
    src = source({ parentTaskId: null });
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.parent).toEqual({ choice: 'project', task: null });
  });
});

describe('clone load: the source and its values', () => {
  it('seeds every copied field, as the bases the save diffs against', async () => {
    const { ret } = await loadFrom('src-1');
    expect(ret!.clone.source).toEqual({ id: 'src-1', handle: 'AT3.2', title: 'Ship it' });
    expect(ret!.clone.values).toMatchObject({
      title: 'Ship it', description: 'The plan', source: 'http://x', tags: 'a, b',
      closeSessionWhenDone: true, priority: 2,
    });
    expect(JSON.parse(ret!.clone.values.references)).toEqual([{ kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT1', label: 'First' }]);
    expect(JSON.parse(ret!.clone.values.requirements)).toEqual({ role: 'portal-engineer', familyIn: ['claude'], familyNotIn: [], excludeWorkers: ['w9'], minTier: 'mid' });
  });

  it('a cross-App source redirects to its own App’s clone URL', async () => {
    src = source({ appId: 'app-2' });
    const { thrown } = await loadFrom('src-1');
    expect(thrown?.status).toBe(303);
    expect(thrown?.location).toBe('/app/apps/app-2/tasks/new?from=src-1');
  });

  it('every clone-load 404 site is pinned to the bare wording, each reachable on its own', async () => {
    // portal#2202, George's P2 on the LOCAL review: the gate is the exact
    // wording per 404 site, each mutant red. Status-only assertions let BOTH
    // clone-load messages revert to the retired "or you can’t see it" oracle
    // wording with the whole suite still green. The two throws in
    // new/+page.server.ts are pinned separately: a cross-App URN is unknown
    // BEFORE any task read (resolveSegment), while a bare ref and a null
    // source read both land on the src-null throw after the read.
    expect((await loadFrom('hrn:agenttask:acme.com:other:AT3')).thrown).toMatchObject({ status: 404, body: { message: 'Task not found' } });
    expect((await loadFrom('n0pe')).thrown).toMatchObject({ status: 404, body: { message: 'Task not found' } });
    src = null;
    expect((await loadFrom('src-1')).thrown).toMatchObject({ status: 404, body: { message: 'Task not found' } });
  });

  it('without ?from= there is no clone pre-fill and no source read', async () => {
    const { ret } = await loadFrom(null);
    expect(ret!.clone).toBeNull();
    expect(request.mock.calls.some(([q]) => q === AGENT_TASK_DETAIL_QUERY)).toBe(false);
  });
});
