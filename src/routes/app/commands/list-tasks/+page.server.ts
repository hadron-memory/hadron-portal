import { gqlClient } from '$lib/server/api';
import { RUNNABLE_NODES_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { t } from '$lib/i18n/t';
import type { MemoryNode } from '$lib/types';
import type { PageServerLoad } from './$types';

// #392 — "List tasks" command page. Unlike the other command pages (which
// submit a form), this is a READ/LIST page: it lists every runnable node
// (Node.isRunnable=true) the caller can access. No action — the shared
// /app/commands layout still provides the title/description chrome.

// Getters (not eager `t()` values): re-evaluate per request when `command` is
// serialized in load(), so a future locale-aware t() isn't frozen to the
// module's startup locale.
const COMMAND = {
  id: 'list-tasks',
  // Full content width — this is a table/list page, not a form (commands
  // layout defaults to a narrow column; `wide` opts into the full width).
  wide: true,
  get title() {
    return t('commands.list-tasks.title', 'List tasks');
  },
  get description() {
    return t('commands.list-tasks.description', 'Every runnable node (a task) across the memories you can access.');
  },
};

// Cap the listing; flagged in the UI if we hit it (a paginated view can come later).
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
    console.error('[list-tasks] RUNNABLE_NODES_QUERY failed:', err);
    failed = true;
  }

  // Truncation reflects the server cap — computed from the RAW count, before the
  // resolvable-URN filter below (so dropped rows can't mask it).
  const truncated = nodes.length >= LIMIT;

  const tasks = nodes
    // Drop any node we can't build a real node URN for: a bare loc would
    // mis-render the <Urn type="node"/> chip and 404 the /app/u resolver link.
    // (Node.memory is nullable in the shared types; Memory.urn is not.)
    .filter((n) => !!n.memory?.urn && !!n.loc)
    .map((n) => ({
      id: n.id,
      loc: n.loc,
      name: n.name,
      description: n.description ?? null,
      nodeType: n.nodeType,
      urn: composeNodeUrn(n.memory!.urn, n.loc),
    }));

  return {
    command: COMMAND,
    tasks,
    failed,
    truncated,
  };
};
