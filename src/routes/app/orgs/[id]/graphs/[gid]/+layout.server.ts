import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, GRAPH_NODES_QUERY, GRAPH_USAGE_SUMMARY_QUERY } from '$lib/server/queries';
import { buildTreeEntries, buildGraphViewData } from '$lib/graph-utils';
import type { Organization, GraphNode, UsageSummaryEntry } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const [orgData, nodesData, usageData] = await Promise.all([
    gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    ),
    gqlClient(locals.token).request<{ nodes: GraphNode[] }>(
      GRAPH_NODES_QUERY, { limit: 5000 },
    ),
    gqlClient(locals.token).request<{ graphUsageSummary: UsageSummaryEntry[] }>(
      GRAPH_USAGE_SUMMARY_QUERY, { graphId: params.gid },
    ).catch(() => ({ graphUsageSummary: [] as UsageSummaryEntry[] })),
  ]);

  const graph = (orgData.organization?.graphs ?? []).find((g) => g.id === params.gid);
  if (!graph) throw new Error('Graph not found');

  // Filter nodes to this graph
  const graphNodes = nodesData.nodes.filter((n) => n.graphId === params.gid);

  const treeEntries = buildTreeEntries(graphNodes);
  const graphViewData = buildGraphViewData(graphNodes);

  // Build usage map: nodeLoc → { type → count }
  const usageByNode: Record<string, Record<string, number>> = {};
  for (const entry of usageData.graphUsageSummary) {
    if (!usageByNode[entry.nodeLoc]) usageByNode[entry.nodeLoc] = {};
    usageByNode[entry.nodeLoc][entry.type] = entry.count;
  }

  return {
    org: orgData.organization,
    graph,
    graphNodes,
    treeEntries,
    graphViewData,
    usageByNode,
  };
};
