import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, GRAPH_NODES_QUERY, MEMORY_USAGE_SUMMARY_QUERY } from '$lib/server/queries';
import { buildTreeEntries, buildGraphViewData } from '$lib/graph-utils';
import type { Organization, MemoryNode, UsageSummaryEntry } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const [orgData, nodesData, usageData] = await Promise.all([
    gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    ),
    gqlClient(locals.token).request<{ nodes: MemoryNode[] }>(
      GRAPH_NODES_QUERY, { limit: 5000 },
    ),
    gqlClient(locals.token).request<{ memoryUsageSummary: UsageSummaryEntry[] }>(
      MEMORY_USAGE_SUMMARY_QUERY, { memoryId: params.gid },
    ).catch(() => ({ memoryUsageSummary: [] as UsageSummaryEntry[] })),
  ]);

  const memory = (orgData.organization?.memories ?? []).find((m) => m.id === params.gid);
  if (!memory) throw new Error('Memory not found');

  // Filter nodes to this memory
  const memoryNodes = nodesData.nodes.filter((n) => n.memoryId === params.gid);

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
