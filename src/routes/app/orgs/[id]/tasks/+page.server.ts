import { gqlClient } from '$lib/server/api';
import { RUNNABLE_NODES_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { PageServerLoad } from './$types';

// "Task Nodes" — runnable nodes (Node.isRunnable=true) scoped to the ACTIVE
// org's memories, mirroring the other org-scoped sections (memories/agents/
// apps under /app/orgs/[id]/). The org (with its memories) is loaded by the
// org [id] layout, so we read it from `parent()` and scope the query to its
// memory ids rather than listing every accessible task.

// Cap the listing; flagged in the UI if we hit it.
const LIMIT = 500;

// Only the fields RUNNABLE_NODES_QUERY actually selects (not the full MemoryNode).
type RunnableNode = Pick<MemoryNode, 'id' | 'memoryId' | 'loc' | 'name' | 'description' | 'nodeType'> & {
  memory?: { id: string; urn: string; name: string } | null;
};

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { org } = await parent();
  const memoryIds = (org?.memories ?? []).map((m) => m.id);

  // No org memories → no tasks. Critically, do NOT call nodes() with an empty
  // memoryIds set: the server treats "omit memoryIds" as "every accessible
  // memory", so an empty org would otherwise leak the global task list.
  if (memoryIds.length === 0) return { tasks: [], failed: false, truncated: false };

  let nodes: RunnableNode[] = [];
  let failed = false;
  try {
    const data = await gqlClient(locals.token).request<{ nodes: RunnableNode[] }>(
      RUNNABLE_NODES_QUERY,
      { limit: LIMIT, memoryIds },
    );
    nodes = data?.nodes ?? [];
  } catch (err) {
    console.error('[org tasks] RUNNABLE_NODES_QUERY failed:', err);
    failed = true;
  }

  // Truncation reflects the server cap — computed from the RAW count, before the
  // resolvable-URN filter below (so dropped rows can't mask it).
  const truncated = nodes.length >= LIMIT;

  const tasks = nodes
    // Drop any node we can't build a real node URN for: a bare loc would
    // mis-render the <Urn type="node"/> chip and 404 the /app/u resolver link.
    .filter((n) => !!n.memory?.urn && !!n.loc)
    .map((n) => ({
      id: n.id,
      loc: n.loc,
      name: n.name,
      description: n.description ?? null,
      urn: composeNodeUrn(n.memory!.urn, n.loc),
    }));

  return { tasks, failed, truncated };
};
