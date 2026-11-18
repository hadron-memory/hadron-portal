/**
 * portal#1524: the node-list drain the memory layout used to run (#447) now lives
 * in `$lib/server/memory-graph-drain`, called by NOTHING, kept so the lazy tree
 * (portal#1438) can start from a working paged read. These are the layout's old
 * reconstruction tests, pointed at the helper so the kept code stays proven.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_NODES_QUERY, MEMORY_EDGES_QUERY } from '$lib/server/queries';
import { fetchGraph, reconstructNodes } from './memory-graph-drain';

const mockRequest = vi.fn();
beforeEach(() => {
  mockRequest.mockReset();
});

const MEMORY = { id: 'mem-1', urn: 'org::mem', name: 'Mem', organizationId: null } as never;

async function importLoad() {
  return async (_ev?: unknown) => {
    const g = await fetchGraph({ request: mockRequest } as never, 'mem-1');
    if ('failed' in g) return { nodesTotal: null, nodesFailed: true, graphNodes: [] };
    return { nodesTotal: g.nodesTotal, nodesFailed: false, graphNodes: reconstructNodes(g.nodes, g.edges, MEMORY) };
  };
}
const ev = (): void => undefined;

type SlimNode = { id: string; loc: string; name: string; nodeType: string; tags: string[]; seq: number | null; isRunnable: boolean | null; description: string | null; openThreads: number };
type SlimEdge = { id: string; loc: string; name: string | null; sourceId: string; targetId: string };

function node(id: string, extra: Partial<SlimNode> = {}): SlimNode {
  return { id, loc: id, name: id.toUpperCase(), nodeType: 'info', tags: [], seq: null, isRunnable: null, description: null, openThreads: 0, ...extra };
}

function routeMock(opts: {
  nodePages?: SlimNode[][]; // one array per offset page (0, 2000, …)
  total?: number;
  edges?: SlimEdge[]; // convenience: a single edge page
  edgePages?: SlimEdge[][]; // explicit multi-page edges
  edgeTotal?: number;
  nodesThrow?: boolean;
}) {
  const { nodePages = [[]], total = 0, edges, edgePages, edgeTotal, nodesThrow = false } = opts;
  const ePages = edgePages ?? [edges ?? []];
  const eTotal = edgeTotal ?? (edges ?? []).length;
  mockRequest.mockImplementation(async (query: string, vars: { offset?: number } = {}) => {
    if (query === '__memory__') {
      return { memory: { id: 'mem-1', urn: 'org::mem', name: 'Mem', organizationId: null } };
    }
    if (query === MEMORY_NODES_QUERY) {
      if (nodesThrow) throw new Error('boom');
      const page = nodePages[(vars.offset ?? 0) / 2000] ?? [];
      return { memoryNodes: { nodes: page, total } };
    }
    if (query === MEMORY_EDGES_QUERY) {
      const page = ePages[(vars.offset ?? 0) / 2000] ?? [];
      return { memoryEdges: { edges: page, total: eTotal } };
    }
    if (query === '__usage__') return { memoryUsageSummary: [] };
    return {};
  });
}

type LoadResult = {
  nodesTotal: number | null;
  nodesFailed: boolean;
  graphNodes: Array<{
    id: string;
    seq: number | null;
    isRunnable: boolean | null;
    description: string | null;
    memory?: { urn: string } | null;
    outgoingEdges: Array<{ id: string; target: { id: string } }>;
  }>;
};

describe('memory-graph-drain — slim graph fetch (#447, kept by portal#1524)', () => {
  it('reconstructs nodes with slim fields + memory ref + outgoing edges', async () => {
    routeMock({
      nodePages: [[node('n1', { seq: 2, isRunnable: true, description: 'first' }), node('n2')]],
      total: 2,
      edges: [{ id: 'e1', loc: 'e1', name: 'rel', sourceId: 'n1', targetId: 'n2' }],
    });
    const data = (await (await importLoad())(ev())) as LoadResult;

    expect(data.nodesFailed).toBe(false);
    expect(data.nodesTotal).toBe(2);
    expect(data.graphNodes).toHaveLength(2);

    const n1 = data.graphNodes.find((n) => n.id === 'n1')!;
    expect(n1.seq).toBe(2);
    expect(n1.isRunnable).toBe(true);
    expect(n1.description).toBe('first');
    expect(n1.memory?.urn).toBe('org::mem'); // synthesized from the loaded memory
    expect(n1.outgoingEdges).toHaveLength(1);
    expect(n1.outgoingEdges[0].target.id).toBe('n2');
  });

  it('portal#1014: carries each node\'s openThreads through to graphNodes', async () => {
    routeMock({ nodePages: [[node('a', { openThreads: 3 }), node('b')]], total: 2 });
    const load = await importLoad();
    const data = (await load(ev())) as unknown as { graphNodes: Array<{ id: string; openThreads?: number }> };
    expect(data.graphNodes.map((n) => [n.id, n.openThreads])).toEqual([['a', 3], ['b', 0]]);
  });

  it('drops edges whose endpoint is not in the loaded set (dangling cross-memory)', async () => {
    routeMock({
      nodePages: [[node('n1')]],
      total: 1,
      edges: [{ id: 'e1', loc: 'e1', name: null, sourceId: 'n1', targetId: 'ghost' }],
    });
    const data = (await (await importLoad())(ev())) as LoadResult;
    expect(data.graphNodes.find((n) => n.id === 'n1')!.outgoingEdges).toHaveLength(0);
  });

  it('pages memoryNodes to completion past one page', async () => {
    const first = Array.from({ length: 2000 }, (_, i) => node(`a${i}`));
    routeMock({ nodePages: [first, [node('tail')]], total: 2001 });
    const data = (await (await importLoad())(ev())) as LoadResult;
    expect(data.graphNodes).toHaveLength(2001);
    expect(data.nodesTotal).toBe(2001);
    expect(data.graphNodes.some((n) => n.id === 'tail')).toBe(true);
  });

  it('pages memoryEdges to completion past one page', async () => {
    // 2 nodes, 2001 edges n1→n2 split across two edge pages: all must be
    // reconstructed onto n1, proving pageAll() runs for edges too.
    const firstEdges = Array.from({ length: 2000 }, (_, i) => ({
      id: `e${i}`,
      loc: `e${i}`,
      name: null,
      sourceId: 'n1',
      targetId: 'n2',
    }));
    routeMock({
      nodePages: [[node('n1'), node('n2')]],
      total: 2,
      edgePages: [firstEdges, [{ id: 'eTail', loc: 'eTail', name: null, sourceId: 'n1', targetId: 'n2' }]],
      edgeTotal: 2001,
    });
    const data = (await (await importLoad())(ev())) as LoadResult;
    const n1 = data.graphNodes.find((n) => n.id === 'n1')!;
    expect(n1.outgoingEdges).toHaveLength(2001);
    expect(n1.outgoingEdges.some((e) => e.id === 'eTail')).toBe(true);
  });

  it('flags nodesFailed (and null total, empty nodes) when the fetch errors', async () => {
    routeMock({ nodesThrow: true });
    const data = (await (await importLoad())(ev())) as LoadResult;
    expect(data.nodesFailed).toBe(true);
    expect(data.nodesTotal).toBeNull();
    expect(data.graphNodes).toHaveLength(0);
  });
});


