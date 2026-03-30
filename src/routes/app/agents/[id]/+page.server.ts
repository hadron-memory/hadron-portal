import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, GRAPH_NODES_QUERY } from '$lib/server/queries';
import { requireNonConsumer } from '$lib/server/guards';
import type { Organization, MemoryNode } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const orgsData = await client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));

  // Find the agent across all orgs
  let agent = null;
  let org = null;
  for (const o of orgsData.myOrganizations) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent || !org) throw error(404, 'Agent not found');

  // Load nodes from all memories in this agent
  const memoryIds = (agent.memoryItems ?? []).map((m) => m.memory.id);
  let agentNodes: MemoryNode[] = [];

  if (memoryIds.length > 0) {
    try {
      const nodesData = await client.request<{ nodes: MemoryNode[] }>(GRAPH_NODES_QUERY, { limit: 500 });
      agentNodes = nodesData.nodes.filter((n) => memoryIds.includes(n.memoryId));
    } catch { /* ignore */ }
  }

  return { agent, org, agentNodes };
};
