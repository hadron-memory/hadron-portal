import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, MEMORY_BY_ID_QUERY, GRAPH_NODES_QUERY, MEMORY_USAGE_SUMMARY_QUERY } from '$lib/server/queries';
import { buildTreeEntries, buildGraphViewData } from '$lib/graph-utils';
import type { Organization, Memory, MemoryNode, UsageSummaryEntry } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// #260: memory pages are org-less (`/app/memories/[id]`) so a memory owned by
// an org the user is NOT a member of stays reachable. Data access is keyed on
// the memory id alone; the org is loaded only for breadcrumb + settings chrome.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const [memoryData, nodesData, usageData] = await Promise.all([
    client.request<{ memory: Memory | null }>(
      MEMORY_BY_ID_QUERY, { id: params.id },
    ),
    client.request<{ nodes: MemoryNode[] }>(
      GRAPH_NODES_QUERY, { limit: 5000 },
    ),
    client.request<{ memoryUsageSummary: UsageSummaryEntry[] }>(
      MEMORY_USAGE_SUMMARY_QUERY, { memoryId: params.id },
    ).catch(() => ({ memoryUsageSummary: [] as UsageSummaryEntry[] })),
  ]);

  const memory = memoryData.memory;
  if (!memory) throw error(404, 'Memory not found');

  // Load the owning org for breadcrumb + settings (members/urn). Keyed on the
  // memory's own organizationId, not a URL segment. ORGANIZATION_QUERY is
  // authz-gated, so a non-member viewer gets `org: null` — the settings page
  // guards on that and hides member-only affordances (server enforces anyway).
  // Guard the call: a memory with no owning org id (defensive — the schema
  // types it non-null) would otherwise fire a wasted request / non-null
  // GraphQL validation error.
  const orgData = memory.organizationId
    ? await client
        .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: memory.organizationId })
        .catch(() => ({ organization: null }))
    : { organization: null };

  // Filter nodes to this memory
  const memoryNodes = nodesData.nodes.filter((n) => n.memoryId === params.id);

  const treeEntries = buildTreeEntries(memoryNodes, memory.urn);
  const graphViewData = buildGraphViewData(memoryNodes, memory.urn);

  // Build usage map: nodeLoc → { type → count }
  const usageByNode: Record<string, Record<string, number>> = {};
  for (const entry of usageData.memoryUsageSummary) {
    if (!usageByNode[entry.nodeLoc]) usageByNode[entry.nodeLoc] = {};
    usageByNode[entry.nodeLoc][entry.type] = entry.count;
  }

  return {
    org: orgData.organization,
    graph: memory,
    graphNodes: memoryNodes,
    treeEntries,
    graphViewData,
    usageByNode,
  };
};
