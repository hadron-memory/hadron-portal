import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  ORGANIZATION_QUERY,
  SELF_CAN_WRITE_QUERY,
  MEMORY_BY_ID_QUERY,
  MEMORY_NODES_QUERY,
  MEMORY_EDGES_QUERY,
  MEMORY_USAGE_SUMMARY_QUERY,
} from '$lib/server/queries';
import { buildTreeEntries, buildGraphViewData } from '$lib/graph-utils';
import type {
  Organization,
  Memory,
  MemoryNode,
  NodeEdge,
  NodeSummary,
  UsageSummaryEntry,
} from '$lib/types';
import type { GraphQLClient } from 'graphql-request';
import type { LayoutServerLoad } from './$types';

// #447 / hadron-server#466: slim projections returned by memoryNodes/memoryEdges.
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
  for (let offset = 0; ; offset += GRAPH_PAGE) {
    const page = await run(GRAPH_PAGE, offset);
    total = page.total;
    items.push(...page.items);
    // Stop on a short/empty page too, so a shrinking/missing total can't loop.
    if (page.items.length < GRAPH_PAGE || items.length >= total) break;
  }
  return { items, total };
}

// Two-phase slim fetch: page all nodes, then all edges. Returns a `failed` flag
// (not a throw) so the layout can distinguish a hadron-server error from a
// genuinely empty memory — same contract the old single-query path preserved.
async function fetchGraph(client: GraphQLClient, memoryId: string) {
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
function reconstructNodes(
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

// #260: memory pages are org-less (`/app/memories/[id]`) so a memory owned by
// an org the user is NOT a member of stays reachable. Data access is keyed on
// the memory id alone; the org is loaded only for breadcrumb + settings chrome.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const [memoryData, graphData, usageData] = await Promise.all([
    client.request<{ memory: Memory | null }>(MEMORY_BY_ID_QUERY, { ref: params.id }),
    fetchGraph(client, params.id),
    client
      .request<{ memoryUsageSummary: UsageSummaryEntry[] }>(MEMORY_USAGE_SUMMARY_QUERY, {
        memoryRef: params.id,
      })
      .catch(() => ({ memoryUsageSummary: [] as UsageSummaryEntry[] })),
  ]);

  const memory = memoryData.memory;
  if (!memory) throw error(404, 'Memory not found');

  // #646: ask the same server gate writes use; a share role alone cannot
  // account for another grant. Failure keeps reading available, never editing.
  let canWriteMemory = false;
  if (locals.user?.id) {
    try {
      const access = await client.request<{ effectiveAccess: { canWrite: boolean } }>(SELF_CAN_WRITE_QUERY, {
        user: locals.user.id, resource: memory.urn,
      });
      canWriteMemory = access.effectiveAccess.canWrite === true;
    } catch {
      console.warn('[memory-layout] write access unavailable');
    }
  }

  // Load the owning org for breadcrumb + settings (members/urn). Keyed on the
  // memory's own organizationId, not a URL segment. ORGANIZATION_QUERY is
  // authz-gated, so a non-member viewer gets `org: null` — the settings page
  // guards on that and hides member-only affordances (server enforces anyway).
  // Guard the call: a memory with no owning org id (defensive — the schema
  // types it non-null) would otherwise fire a wasted request / non-null
  // GraphQL validation error.
  const orgData = memory.organizationId
    ? await client
        .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { ref: memory.organizationId })
        .catch(() => ({ organization: null }))
    : { organization: null };

  // A hadron-server error stays distinguishable from a genuinely empty memory
  // (the latter otherwise reads as a silent empty state — this masked the
  // spec-037 edges migration drift once).
  const nodesFailed = 'failed' in graphData;
  const memoryNodes = nodesFailed
    ? []
    : reconstructNodes(graphData.nodes, graphData.edges, memory);
  // #429: the server-reported full node count for this memory (memoryNodes
  // total). Now that we page to completion this equals memoryNodes.length, but
  // keep surfacing it so a future page-cap or partial load stays visible. Null
  // when the fetch failed.
  const nodesTotal = nodesFailed ? null : graphData.nodesTotal;

  let treeEntries: ReturnType<typeof buildTreeEntries> = [];
  let graphViewData = null;
  try {
    treeEntries = buildTreeEntries(memoryNodes, memory.urn);
    graphViewData = buildGraphViewData(memoryNodes, memory.urn);
  } catch (err) {
    console.error('[memory-layout] Error building tree/graph data:', err);
    // Continue with empty data rather than crashing
  }

  // Build usage map: nodeLoc → { type → count }
  const usageByNode: Record<string, Record<string, number>> = {};
  for (const entry of usageData.memoryUsageSummary) {
    if (!usageByNode[entry.nodeLoc]) usageByNode[entry.nodeLoc] = {};
    usageByNode[entry.nodeLoc][entry.type] = entry.count;
  }

  return {
    org: orgData.organization,
    graph: memory,
    canWriteMemory,
    graphNodes: memoryNodes,
    nodesTotal,
    nodesFailed,
    treeEntries,
    graphViewData,
    usageByNode,
  };
};
