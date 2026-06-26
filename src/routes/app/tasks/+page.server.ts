import { gqlClient } from '$lib/server/api';
import { RUNNABLE_NODES_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { PageServerLoad } from './$types';

// "Task Nodes" — a top-level page listing every runnable node
// (Node.isRunnable=true) the caller can access. Promoted out of
// /app/commands/list-tasks: it's its own nav entry now, not a command-bar
// command, so it owns its chrome (no commands layout) and renders the table
// directly.

// Cap the listing; flagged in the UI if we hit it.
const LIMIT = 500;

// Only the fields RUNNABLE_NODES_QUERY actually selects (not the full MemoryNode).
type RunnableNode = Pick<MemoryNode, 'id' | 'memoryId' | 'loc' | 'name' | 'description' | 'nodeType'> & {
  memory?: { id: string; urn: string; name: string } | null;
};

export const load: PageServerLoad = async ({ locals }) => {
  let nodes: RunnableNode[] = [];
  let failed = false;
  try {
    const data = await gqlClient(locals.token).request<{ nodes: RunnableNode[] }>(
      RUNNABLE_NODES_QUERY,
      { limit: LIMIT },
    );
    nodes = data?.nodes ?? [];
  } catch (err) {
    console.error('[tasks] RUNNABLE_NODES_QUERY failed:', err);
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
      nodeType: n.nodeType,
      urn: composeNodeUrn(n.memory!.urn, n.loc),
    }));

  return { tasks, failed, truncated };
};
