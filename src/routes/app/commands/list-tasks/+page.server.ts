import { gqlClient } from '$lib/server/api';
import { RUNNABLE_NODES_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { PageServerLoad } from './$types';

// #392 — "List tasks" command page. Unlike the other command pages (which
// submit a form), this is a READ/LIST page: it lists every runnable node
// (Node.isRunnable=true) the caller can access. No action — the shared
// /app/commands layout still provides the title/description chrome.

const COMMAND = {
  id: 'list-tasks',
  title: 'List tasks',
  description: 'Every runnable node (a task) across the memories you can access.',
};

// Cap the listing; flagged in the UI if we hit it (a paginated view can come later).
const LIMIT = 500;

type RunnableNode = MemoryNode & { memory?: { id: string; urn: string; name: string } | null };

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ nodes: RunnableNode[] }>(RUNNABLE_NODES_QUERY, { limit: LIMIT })
    .catch((err) => {
      console.error('[list-tasks] RUNNABLE_NODES_QUERY failed:', err);
      return { nodes: [] as RunnableNode[], failed: true };
    });

  const nodes = data?.nodes ?? [];
  const failed = !!data && 'failed' in data && data.failed === true;

  const tasks = nodes.map((n) => ({
    id: n.id,
    loc: n.loc,
    name: n.name,
    description: n.description ?? null,
    nodeType: n.nodeType,
    memoryName: n.memory?.name ?? null,
    // Full node URN for the <Urn> chip + the /app/u resolver link. composeNodeUrn
    // throws on an empty memory URN — fall back to the bare loc then.
    urn: n.memory?.urn && n.loc ? composeNodeUrn(n.memory.urn, n.loc) : n.loc,
  }));

  return {
    command: COMMAND,
    tasks,
    failed,
    truncated: tasks.length >= LIMIT,
  };
};
