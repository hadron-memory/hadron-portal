/**
 * #447 — (since portal#1433 the graph tests live in ./(browser)/layout.server.test.ts;
 * the memory layout here loads none) the memory-detail layout loaded its node/graph data via the slim,
 * paginated memoryNodes/memoryEdges primitives (hadron-server#466/#513) and
 * reconstructs the MemoryNode[] the tree/graph/table consume: slim fields +
 * synthesized `memory` ref + outgoing edges rebuilt from the edge list (with
 * dangling cross-memory targets dropped). #429's `nodesTotal` still rides
 * through (from memoryNodes.total).
 *
 * Pattern mirrors the sibling page.server tests: mock `$lib/server/api`'s
 * `gqlClient`, route `request` by query identity, call `load` directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_BY_ID_QUERY,
  SELF_CAN_WRITE_QUERY,
  MEMORY_NODES_QUERY,
  MEMORY_EDGES_QUERY,
  MEMORY_USAGE_SUMMARY_QUERY,
  MEMORY_LAYOUT_ORG_QUERY,
  ORGANIZATION_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

// The tree/graph builders have their own tests; stub them so this loader test
// asserts the reconstruction (graphNodes) directly.
vi.mock('$lib/graph-utils', () => ({
  buildTreeEntries: () => [],
  buildGraphViewData: () => ({ topics: [], folderNodes: [], hierEdges: [] }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+layout.server');
  return mod.load;
}

function ev(id = 'mem-1') {
  return { params: { id }, locals: { token: 'test-token' } } as unknown as Parameters<
    Awaited<ReturnType<typeof importLoad>>
  >[0];
}

function routeMock(_opts: Record<string, never> = {}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === MEMORY_BY_ID_QUERY) {
      return { memory: { id: 'mem-1', urn: 'org::mem', name: 'Mem', organizationId: null } };
    }
    return {};
  });
}

describe('reader-shared memory controls (#646)', () => {
  it.each([false, true])('carries the server write decision %s for the current user and memory URN', async (canWrite) => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => q === SELF_CAN_WRITE_QUERY
      ? Promise.resolve({ effectiveAccess: { canWrite } }) : normal(q, v));
    const event = ev();
    event.locals.user = { id: 'reader-user' } as any;
    const data = await (await importLoad())(event) as any;
    expect(mockRequest).toHaveBeenCalledWith(SELF_CAN_WRITE_QUERY, { user: 'reader-user', resource: 'org::mem' });
    expect(data.canWriteMemory).toBe(canWrite);
  });
  it('keeps the memory readable but offers no writes when the access check fails', async () => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => q === SELF_CAN_WRITE_QUERY
      ? Promise.reject(new Error('access service unavailable')) : normal(q, v));
    const event = ev();
    event.locals.user = { id: 'reader-user' } as any;
    const data = await (await importLoad())(event) as any;
    expect(data.graph.id).toBe('mem-1');
    expect(data.canWriteMemory).toBe(false);
  });
});

describe('memory layout payload slimming (portal#1429)', () => {
  it('returns no treeEntries, graphViewData or usageByNode, and never asks for memory usage', async () => {
    routeMock();
    const data = (await (await importLoad())(ev())) as Record<string, unknown>;
    for (const key of ['treeEntries', 'graphViewData', 'usageByNode']) expect(data).not.toHaveProperty(key);
    expect(mockRequest.mock.calls.map((c) => c[0])).not.toContain(MEMORY_USAGE_SUMMARY_QUERY);
  });

  it('portal#1433: loads no node graph at all (graphNodes absent, no memoryNodes/memoryEdges request)', async () => {
    routeMock();
    const data = (await (await importLoad())(ev())) as Record<string, unknown>;
    for (const key of ['graphNodes', 'nodesTotal', 'nodesFailed']) expect(data).not.toHaveProperty(key);
    const queries = mockRequest.mock.calls.map((c) => c[0]);
    expect(queries).not.toContain(MEMORY_NODES_QUERY);
    expect(queries).not.toContain(MEMORY_EDGES_QUERY);
  });

  it('loads the owning org through the slim selection, not ORGANIZATION_QUERY', async () => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => {
      if (q === MEMORY_BY_ID_QUERY) return Promise.resolve({ memory: { id: 'mem-1', urn: 'org::mem', name: 'Mem', organizationId: 'org-1' } });
      if (q === MEMORY_LAYOUT_ORG_QUERY) return Promise.resolve({ organization: { id: 'org-1', name: 'Org', urn: 'hrn:org:o', members: [] } });
      return normal(q, v);
    });
    const data = (await (await importLoad())(ev())) as { org: { id: string } | null };
    const queries = mockRequest.mock.calls.map((c) => c[0]);
    expect(queries).toContain(MEMORY_LAYOUT_ORG_QUERY);
    expect(queries).not.toContain(ORGANIZATION_QUERY);
    expect(data.org?.id).toBe('org-1');
  });

  it('the slim org document selects none of the list resolvers no memory route reads', () => {
    for (const field of ['memories', 'agents', 'subscriptions', 'exchangeConnections']) {
      expect(MEMORY_LAYOUT_ORG_QUERY).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
    // What the routes do read must stay selected.
    for (const field of ['id', 'name', 'urn', 'members', 'role', 'user']) {
      expect(MEMORY_LAYOUT_ORG_QUERY).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
