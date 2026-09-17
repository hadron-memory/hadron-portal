/**
 * Tasks-tab loader (#845, @copilot on #847).
 *
 * This loader had no test, which #847 made worth fixing rather than noting:
 * it moved off `parent()` onto its own `ORG_TASK_MEMORY_IDS_QUERY`, and the ids
 * that query returns are the SECURITY BOUNDARY for `RUNNABLE_NODES_QUERY` —
 * the server reads an omitted `memoryIds` as "every accessible memory", so an
 * org with none must short-circuit rather than query with an empty set.
 *
 * The empty-org case is therefore pinned in the strong form: not merely that
 * the result is empty, but that the nodes query was never ISSUED. An assertion
 * on the returned rows alone passes just as happily on a global leak that
 * happened to return nothing for this fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_TASK_MEMORY_IDS_QUERY, RUNNABLE_NODES_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev(orgId = 'org-1') {
  return {
    params: { id: orgId },
    locals: { token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/** Route by document: the org slice, then the runnable-nodes search. */
function route(opts: { memories?: Array<{ id: string }>; nodes?: unknown[]; nodesThrow?: boolean }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORG_TASK_MEMORY_IDS_QUERY) {
      return { organization: { id: 'org-1', memories: opts.memories ?? [] } };
    }
    if (query === RUNNABLE_NODES_QUERY) {
      if (opts.nodesThrow) throw new Error('boom');
      return { findNodes: { hits: (opts.nodes ?? []).map((node) => ({ node })) } };
    }
    throw new Error(`Unexpected query: ${String(query).slice(0, 40)}`);
  });
}

const node = (id: string, loc: string) => ({
  id,
  memoryId: 'mem-1',
  loc,
  name: `Task ${id}`,
  description: null,
  nodeType: 'task',
  memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:ops', name: 'Ops' },
});

describe('org tasks load()', () => {
  it('fetches the org memory ids itself, not from the layout', async () => {
    route({ memories: [{ id: 'mem-1' }] });
    const load = await importLoad();
    await load(ev());
    expect(mockRequest).toHaveBeenCalledWith(ORG_TASK_MEMORY_IDS_QUERY, { ref: 'org-1' });
  });

  it('scopes the nodes query to exactly the org memory ids', async () => {
    route({ memories: [{ id: 'mem-1' }, { id: 'mem-2' }], nodes: [node('n1', 'tasks:one')] });
    const load = await importLoad();
    await load(ev());
    const call = mockRequest.mock.calls.find(([q]) => q === RUNNABLE_NODES_QUERY);
    expect(call?.[1]).toMatchObject({ memoryIds: ['mem-1', 'mem-2'] });
  });

  it('an org with no memories issues NO nodes query at all', async () => {
    // The security assertion. `nodes()` with an omitted/empty memoryIds is read
    // server-side as "every accessible memory", so short-circuiting is what
    // stops the global task list leaking into an empty org's tab.
    route({ memories: [] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: unknown[]; failed: boolean };

    expect(result.tasks).toEqual([]);
    expect(result.failed).toBe(false);
    expect(mockRequest.mock.calls.filter(([q]) => q === RUNNABLE_NODES_QUERY)).toHaveLength(0);
    // …and the org slice WAS fetched, so "issued nothing at all" cannot pass this.
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_TASK_MEMORY_IDS_QUERY)).toHaveLength(1);
  });

  it('a nodes-query failure degrades to failed:true rather than throwing', async () => {
    route({ memories: [{ id: 'mem-1' }], nodesThrow: true });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: unknown[]; failed: boolean };
    expect(result.failed).toBe(true);
    expect(result.tasks).toEqual([]);
  });

  it('drops a node whose URN cannot be composed, keeping the rest', async () => {
    const orphan = { ...node('n2', 'tasks:two'), memory: null };
    route({ memories: [{ id: 'mem-1' }], nodes: [node('n1', 'tasks:one'), orphan] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: Array<{ id: string; urn: string }> };
    expect(result.tasks.map((t) => t.id)).toEqual(['n1']);
    expect(result.tasks[0].urn).toContain('hrn:node:');
  });
});
