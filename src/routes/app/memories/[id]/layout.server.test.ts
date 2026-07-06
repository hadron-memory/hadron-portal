/**
 * #429 — the memory-detail layout loader threads the server-reported full node
 * count (`findNodes.total`) through as `nodesTotal`, so the browse view can show
 * "N of M" and flag a truncated (capped) window instead of silently truncating.
 *
 * Pattern mirrors the sibling page.server tests: mock `$lib/server/api`'s
 * `gqlClient`, route `request` by query identity, call `load` directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_BY_ID_QUERY,
  GRAPH_NODES_QUERY,
  MEMORY_USAGE_SUMMARY_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

// The tree/graph builders are exercised by their own tests; stub them so this
// loader test doesn't depend on full node shapes.
vi.mock('$lib/graph-utils', () => ({
  buildTreeEntries: () => [],
  buildGraphViewData: () => ({ topics: [], folderNodes: [], hierEdges: [] }),
}));

beforeEach(() => mockRequest.mockReset());

async function importLoad() {
  const mod = await import('./+layout.server');
  return mod.load;
}

function ev(id = 'mem-1') {
  return {
    params: { id },
    locals: { token: 'test-token' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/** Route by query identity; `total` and node hits are configurable per test. */
function routeMock(opts: { total?: number | null; hits?: number; nodesThrow?: boolean }) {
  const { total = null, hits = 0, nodesThrow = false } = opts;
  mockRequest.mockImplementation(async (query: string) => {
    if (query === MEMORY_BY_ID_QUERY) {
      // organizationId null → the loader skips the ORGANIZATION_QUERY branch.
      return { memory: { id: 'mem-1', urn: 'org::mem', organizationId: null } };
    }
    if (query === GRAPH_NODES_QUERY) {
      if (nodesThrow) throw new Error('boom');
      const node = { id: 'n1', memoryId: 'mem-1', loc: 'a', name: 'A' };
      return { findNodes: { hits: Array.from({ length: hits }, () => ({ node })), total } };
    }
    if (query === MEMORY_USAGE_SUMMARY_QUERY) return { memoryUsageSummary: [] };
    return {};
  });
}

describe('memory-detail layout — nodesTotal (#429)', () => {
  it('threads findNodes.total through as nodesTotal', async () => {
    routeMock({ total: 8000, hits: 1 });
    const load = await importLoad();
    const data = (await load(ev())) as { nodesTotal: number | null; nodesFailed: boolean };
    expect(data.nodesTotal).toBe(8000);
    expect(data.nodesFailed).toBe(false);
  });

  it('is null when the node query fails (distinct from an empty memory)', async () => {
    routeMock({ nodesThrow: true });
    const load = await importLoad();
    const data = (await load(ev())) as { nodesTotal: number | null; nodesFailed: boolean };
    expect(data.nodesTotal).toBeNull();
    expect(data.nodesFailed).toBe(true);
  });

  it('is null when the server omits total (older server)', async () => {
    routeMock({ total: null, hits: 2 });
    const load = await importLoad();
    const data = (await load(ev())) as { nodesTotal: number | null };
    expect(data.nodesTotal).toBeNull();
  });
});
