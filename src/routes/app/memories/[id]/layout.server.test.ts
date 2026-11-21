/**
 * #447 — the memory-detail layout loads its node/graph data via the slim,
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

type SlimNode = {
  id: string;
  loc: string;
  name: string;
  nodeType: string;
  tags: string[];
  seq: number | null;
  isRunnable: boolean | null;
  description: string | null;
  openThreads: number;
};
type SlimEdge = { id: string; loc: string; name: string | null; sourceId: string; targetId: string };

function routeMock(opts: { nodesThrow?: boolean } = {}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === MEMORY_BY_ID_QUERY) {
      return { memory: { id: 'mem-1', urn: 'org::mem', name: 'Mem', organizationId: null } };
    }
    if (query === MEMORY_NODES_QUERY || query === MEMORY_EDGES_QUERY) {
      if (opts.nodesThrow) throw new Error('boom');
      return { memoryNodes: { nodes: [], total: 0 }, memoryEdges: { edges: [], total: 0 } };
    }
    if (query === MEMORY_USAGE_SUMMARY_QUERY) return { memoryUsageSummary: [] };
    return {};
  });
}

describe('memory-detail layout — no node-list drain (portal#1524)', () => {
  it('never asks for memoryNodes or memoryEdges, whatever the server would answer', async () => {
    routeMock();
    await (await importLoad())(ev());
    const asked = mockRequest.mock.calls.map(([q]) => q);
    expect(asked).not.toContain(MEMORY_NODES_QUERY);
    expect(asked).not.toContain(MEMORY_EDGES_QUERY);
  });

  it('says the list is OFF, distinctly from failed, and carries no graph or tree keys', async () => {
    routeMock();
    const data = (await (await importLoad())(ev())) as Record<string, unknown>;
    expect(data.nodesOff).toBe(true);
    expect(data.nodesFailed).toBe(false); // an error banner would be a false statement
    expect(data.nodesTotal).toBeNull(); // not 0: no count is being claimed
    for (const key of ['graphNodes', 'treeEntries', 'graphViewData', 'usageByNode']) {
      expect(Object.keys(data)).not.toContain(key);
    }
  });

  it('is unaffected by a node-list outage, because it never reads the list', async () => {
    routeMock({ nodesThrow: true });
    const data = (await (await importLoad())(ev())) as Record<string, unknown>;
    expect(data.nodesFailed).toBe(false);
    expect(data.nodesOff).toBe(true);
  });
});


describe('reader-shared memory controls (#646)', () => {
  it.each([
    { canWrite: false, canManage: false },
    { canWrite: true, canManage: false },
    { canWrite: true, canManage: true },
  ])('carries independent server write/manage decisions for the current user and memory URN', async ({ canWrite, canManage }) => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => q === SELF_CAN_WRITE_QUERY
      ? Promise.resolve({ effectiveAccess: { canWrite, canManage } }) : normal(q, v));
    const event = ev();
    event.locals.user = { id: 'reader-user' } as any;
    const data = await (await importLoad())(event) as any;
    expect(mockRequest).toHaveBeenCalledWith(SELF_CAN_WRITE_QUERY, { user: 'reader-user', resource: 'org::mem' });
    expect(data.canWriteMemory).toBe(canWrite);
    expect(data.canManageMemory).toBe(canManage);
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
    expect(data.canManageMemory).toBe(false);
  });
});

describe('memory layout payload slimming (portal#1429)', () => {
  it('returns no treeEntries, graphViewData or usageByNode, and never asks for memory usage', async () => {
    routeMock();
    const data = (await (await importLoad())(ev())) as Record<string, unknown>;
    for (const key of ['treeEntries', 'graphViewData', 'usageByNode']) expect(data).not.toHaveProperty(key);
    expect(mockRequest.mock.calls.map((c) => c[0])).not.toContain(MEMORY_USAGE_SUMMARY_QUERY);
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

  it('skips the member hydration query when the nested organization is already null', async () => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => {
      if (q === MEMORY_BY_ID_QUERY) return Promise.resolve({
        memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem', name: 'Mem', organizationId: 'org-1', organization: null },
      });
      return normal(q, v);
    });
    const data = (await (await importLoad())(ev())) as { org: unknown; orgReadFailed: boolean };
    expect(mockRequest.mock.calls.map(([query]) => query)).not.toContain(MEMORY_LAYOUT_ORG_QUERY);
    expect(data.org).toBeNull();
    expect(data.orgReadFailed).toBe(false);
  });

  it.each(['FORBIDDEN', 'UNAUTHENTICATED'])('maps a member-query %s to non-membership, not an outage', async (code) => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => {
      if (q === MEMORY_BY_ID_QUERY) return Promise.resolve({
        memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem', name: 'Mem', organizationId: 'org-1', organization: { id: 'org-1', name: 'Org' } },
      });
      if (q === MEMORY_LAYOUT_ORG_QUERY) return Promise.reject({
        response: { errors: [{ message: code, extensions: { code } }] },
      });
      return normal(q, v);
    });
    const data = (await (await importLoad())(ev())) as { org: unknown; orgReadFailed: boolean };
    expect(data.org).toBeNull();
    expect(data.orgReadFailed).toBe(false);
  });

  it('does not treat a permanent organization refusal as a transient outage', async () => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => {
      if (q === MEMORY_BY_ID_QUERY) return Promise.resolve({
        memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem', name: 'Mem', organizationId: 'org-1', organization: { id: 'org-1', name: 'Org' } },
      });
      if (q === MEMORY_LAYOUT_ORG_QUERY) return Promise.reject({
        response: { errors: [{ message: 'Organization not found', extensions: { code: 'ORGANIZATION_NOT_FOUND' } }] },
      });
      return normal(q, v);
    });
    const data = (await (await importLoad())(ev())) as { org: unknown; orgReadFailed: boolean };
    expect(data.org).toBeNull();
    expect(data.orgReadFailed).toBe(false);
  });

  it('distinguishes an org read outage from a non-member null response', async () => {
    routeMock({});
    const normal = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((q, v) => {
      if (q === MEMORY_BY_ID_QUERY) return Promise.resolve({ memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem', name: 'Mem', organizationId: 'org-1' } });
      if (q === MEMORY_LAYOUT_ORG_QUERY) return Promise.reject(new Error('timeout'));
      return normal(q, v);
    });
    const data = (await (await importLoad())(ev())) as { org: unknown; orgReadFailed: boolean };
    expect(data.org).toBeNull();
    expect(data.orgReadFailed).toBe(true);
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
