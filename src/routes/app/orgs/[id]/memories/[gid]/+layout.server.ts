import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, MEMORY_BY_ID_QUERY, GRAPH_NODES_QUERY, MEMORY_USAGE_SUMMARY_QUERY } from '$lib/server/queries';
import { buildTreeEntries, buildGraphViewData } from '$lib/graph-utils';
import type { Organization, Memory, MemoryNode, UsageSummaryEntry } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals, parent }) => {
  const parentData = await parent();
  const client = gqlClient(locals.token);
  const [orgData, memoryData, nodesData, usageData] = await Promise.all([
    client.request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    ),
    client.request<{ memory: Memory | null }>(
      MEMORY_BY_ID_QUERY, { id: params.gid },
    ),
    client.request<{ nodes: MemoryNode[] }>(
      GRAPH_NODES_QUERY, { limit: 5000 },
    ),
    client.request<{ memoryUsageSummary: UsageSummaryEntry[] }>(
      MEMORY_USAGE_SUMMARY_QUERY, { memoryId: params.gid },
    ).catch(() => ({ memoryUsageSummary: [] as UsageSummaryEntry[] })),
  ]);

  const memory = memoryData.memory;
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

  // 010-create-node-on-portal: gate the tree's create-child affordance.
  // Server-side authz remains the trust boundary — see upsertNode resolver's
  // requireMemoryWriteAccess. This flag is presentation only.
  const canWrite = !parentData.isConsumerMode;

  return {
    org: orgData.organization,
    graph: memory,
    graphNodes: memoryNodes,
    treeEntries,
    graphViewData,
    usageByNode,
    canWrite,
    writableMemoryIds: canWrite ? [memory.id] : [],
  };
};
