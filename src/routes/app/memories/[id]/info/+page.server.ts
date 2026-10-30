import { gqlClient } from '$lib/server/api';
import { MEMORY_NODE_COUNT_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

// portal#1433: the node count is one `memoryNodes(limit: 1).total` read, not the
// length of a node list the memory layout no longer ships. A failed read is
// `null`, shown as unknown, never as an empty memory.
export const load: PageServerLoad = async ({ params, locals }) => {
  const nodeCount = await gqlClient(locals.token)
    .request<{ memoryNodes: { total: number } }>(MEMORY_NODE_COUNT_QUERY, { memoryRef: params.id })
    .then((d) => d.memoryNodes.total)
    .catch((err) => {
      console.error('[memory-info] node count failed:', err);
      return null;
    });
  return { nodeCount };
};
