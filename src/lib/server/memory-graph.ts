/**
 * The memory's whole node graph, drained page by page (#447, hadron-server#466).
 *
 * Lives here, not in the memory layout, since portal#1433: only the Nodes and
 * Graph tabs read it (the `(browser)` route group's layout calls this), so every
 * other memory route (node detail, new node, info, settings, assets …) loads no
 * graph at all.
 */
import { MEMORY_NODES_QUERY, MEMORY_EDGES_QUERY } from '$lib/server/queries';
import type { Memory, MemoryNode, NodeEdge, NodeSummary } from '$lib/types';
import type { GraphQLClient } from 'graphql-request';

// #447 / hadron-server#466: slim projections returned by memoryNodes/memoryEdges.
export type SlimNode = {
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
export type SlimEdge = { id: string; loc: string; name: string | null; sourceId: string; targetId: string };

// hadron-server caps the graph-fetch page at 2000 (default 1000); page to
// completion so the tree/graph/table see the whole memory, not a truncated
// window (the old GRAPH_NODES_QUERY silently capped at 5000).
const GRAPH_PAGE = 2000;

// The slim projection omits createdAt/updatedAt; no graphNodes consumer reads
// them (chat messages, which do, fetch full nodes separately), but use a valid
// ISO sentinel so an accidental `new Date(...)` yields the epoch, not Invalid
// Date. Matches the fixture-codec fallback convention.
const EPOCH_ISO = new Date(0).toISOString();

async function pageAll<T>(
  run: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  let total = 0;
  for (let offset = 0; ; ) {
    const page = await run(GRAPH_PAGE, offset);
    total = page.total;
    items.push(...page.items);
    // End on an EMPTY page or at `total`, never the first short one (a server
    // clamp returns short non-empty pages); advance by rows returned.
    if (page.items.length === 0 || items.length >= total) break;
    offset += page.items.length;
  }
  return { items, total };
}

// Two-phase slim fetch: page all nodes, then all edges. Returns a `failed` flag
// (not a throw) so the layout can distinguish a hadron-server error from a
// genuinely empty memory — same contract the old single-query path preserved.
export async function fetchGraph(client: GraphQLClient, memoryId: string) {
  try {
    const [nodesPage, edgesPage] = await Promise.all([
      pageAll<SlimNode>(async (limit, offset) => {
        const d = await client.request<{ memoryNodes: { nodes: SlimNode[]; total: number } }>(
          MEMORY_NODES_QUERY,
          { memoryRef: memoryId, limit, offset },
        );
        return { items: d.memoryNodes.nodes, total: d.memoryNodes.total };
      }),
      pageAll<SlimEdge>(async (limit, offset) => {
        const d = await client.request<{ memoryEdges: { edges: SlimEdge[]; total: number } }>(
          MEMORY_EDGES_QUERY,
          { memoryRef: memoryId, limit, offset },
        );
        return { items: d.memoryEdges.edges, total: d.memoryEdges.total };
      }),
    ]);
    return { nodes: nodesPage.items, nodesTotal: nodesPage.total, edges: edgesPage.items };
  } catch (err) {
    console.error('[memory-layout] memoryNodes/memoryEdges failed:', err);
    return { failed: true as const };
  }
}

// Rebuild the MemoryNode[] the tree/graph/table consume from the slim node +
// edge projections. All nodes belong to this one memory, so we synthesize the
// `memory` ref from the loaded memory and reattach each node's outgoing edges;
// downstream (buildTreeEntries/buildGraphViewData, MemoryBrowser, node-detail
// loaders) then works unchanged. Heavy fields (content/abstract/data/dates) are
// intentionally absent from the slim projection — no consumer of `graphNodes`
// reads them — so they're filled with nulls to satisfy the type.
export function reconstructNodes(
  slimNodes: SlimNode[],
  slimEdges: SlimEdge[],
  memory: Memory,
): MemoryNode[] {
  const memRef = { id: memory.id, urn: memory.urn, name: memory.name };
  const summaryById = new Map<string, NodeSummary>();
  for (const n of slimNodes) {
    summaryById.set(n.id, {
      id: n.id,
      loc: n.loc,
      name: n.name,
      description: n.description ?? null,
      tags: n.tags,
      memory: { id: memory.id, urn: memory.urn },
    });
  }

  // Group outgoing edges by source, dropping any whose endpoint isn't loaded
  // (a dangling cross-memory or soft-deleted target — mirrors buildGraphViewData's
  // own idSet filter).
  const outBySource = new Map<string, NodeEdge[]>();
  for (const e of slimEdges) {
    const source = summaryById.get(e.sourceId);
    const target = summaryById.get(e.targetId);
    if (!source || !target) continue;
    const edge: NodeEdge = { id: e.id, name: e.name, loc: e.loc, description: null, isRunnable: null, source, target };
    const list = outBySource.get(e.sourceId);
    if (list) list.push(edge);
    else outBySource.set(e.sourceId, [edge]);
  }

  return slimNodes.map((n) => ({
    id: n.id,
    memoryId: memory.id,
    nodeType: n.nodeType,
    loc: n.loc,
    name: n.name,
    alias: null,
    description: n.description ?? null,
    abstract: null,
    content: null,
    tokens: null,
    tags: n.tags,
    seq: n.seq ?? null,
    data: null,
    ownerRepo: null,
    isRunnable: n.isRunnable ?? null,
    openThreads: n.openThreads,
    createdAt: EPOCH_ISO,
    updatedAt: EPOCH_ISO,
    memory: memRef,
    outgoingEdges: outBySource.get(n.id) ?? [],
    incomingEdges: [],
  }));
}

