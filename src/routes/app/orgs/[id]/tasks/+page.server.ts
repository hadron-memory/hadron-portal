import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { loadOrgDetail } from '$lib/server/org-detail';
import { NODE_BY_ID_QUERY, RUNNABLE_NODES_QUERY, ORG_TASK_MEMORY_IDS_QUERY } from '$lib/server/queries';
// #868: the write goes through the door chooser; naming a mutation document
// here directly is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument, NoNodeDoorError } from '$lib/server/nodeKindDoor';
import { defaultSkillName, taskExport, toggleSkillExport } from '$lib/skill-export';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// "Task Nodes" — runnable nodes (Node.isRunnable=true) scoped to the ACTIVE
// org's memories, mirroring the other org-scoped sections (memories/agents/
// apps under /app/orgs/[id]/). The org (with its memories) is loaded by the
// org [id] layout as CHROME ONLY since #845, so this loader fetches the org's
// memory IDS itself (ORG_TASK_MEMORY_IDS_QUERY) and scopes the query to its
// memory ids rather than listing every accessible task.
//
// #879: the page is also the skill-export surface — a checkbox per row, and
// one download for everything checked (the download is `./plugin`).

// Cap the listing; flagged in the UI if we hit it.
const LIMIT = 500;

// Only the fields RUNNABLE_NODES_QUERY actually selects (not the full MemoryNode).
type RunnableNode = Pick<MemoryNode, 'id' | 'memoryId' | 'loc' | 'name' | 'description' | 'nodeType' | 'properties'> & {
  memory?: { id: string; urn: string; name: string } | null;
};

async function orgMemoryIds(token: string | null | undefined, orgId: string): Promise<string[]> {
  // #845: the layout carries chrome only; this tab needs the full org.
  const org = await loadOrgDetail(token, orgId, ORG_TASK_MEMORY_IDS_QUERY);
  return (org?.memories ?? []).map((m) => m.id);
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const memoryIds = await orgMemoryIds(locals.token, params.id);

  // No org memories → no tasks. Critically, do NOT call nodes() with an empty
  // memoryIds set: the server treats "omit memoryIds" as "every accessible
  // memory", so an empty org would otherwise leak the global task list.
  if (memoryIds.length === 0) return { tasks: [], failed: false, truncated: false };

  let nodes: RunnableNode[] = [];
  let failed = false;
  try {
    const data = await gqlClient(locals.token).request<{
      findNodes: { hits: Array<{ node: RunnableNode }> };
    }>(RUNNABLE_NODES_QUERY, { limit: LIMIT, memoryIds });
    nodes = (data?.findNodes?.hits ?? []).map((h) => h.node);
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
      memoryId: n.memoryId,
      loc: n.loc,
      name: n.name,
      description: n.description ?? null,
      urn: composeNodeUrn(n.memory!.urn, n.loc),
      // Reduced here, so the page never receives the node's properties bag —
      // it can hold anything a user typed, and the list needs one fact of it.
      export: taskExport(n.properties),
    }));

  return { tasks, failed, truncated };
};

/**
 * Why a row's checkbox did not save. A CODE, not prose: server routes here do
 * not localize, so the page maps each code through `t()`. `detail` carries the
 * server's own words where it gave some.
 */
export type ExportFailure = 'invalid' | 'not-found' | 'not-runnable' | 'divergent' | 'no-door' | 'rejected' | 'failed';

function exportFail(status: number, nodeId: string, code: ExportFailure, detail?: string) {
  return fail(status, { exportFailed: { nodeId, code, detail: detail ?? null } });
}

export const actions: Actions = {
  /**
   * #879 — one row's checkbox. The form carries the node id and the state the
   * user asked for, both LITERALS rendered into the row's own form, so nothing
   * is written on click (`review:submitted-value-must-not-be-written-on-click`).
   *
   * The new properties are computed from a FRESH read, never from the page:
   * `updateNode` replaces `properties` whole, so writing back the page's copy
   * would undo any edit made since the list loaded — in another tab, the CLI,
   * or the node's own edit page.
   */
  setExport: async ({ request, params, locals }) => {
    const form = await request.formData();
    const nodeId = String(form.get('nodeId') ?? '');
    const enableRaw = form.get('enable');
    if (!nodeId || (enableRaw !== 'true' && enableRaw !== 'false')) {
      return exportFail(400, nodeId, 'invalid');
    }
    const enable = enableRaw === 'true';
    const client = gqlClient(locals.token);

    let node: MemoryNode | null;
    try {
      ({ node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: nodeId }));
    } catch (e: unknown) {
      return exportFail(500, nodeId, 'failed', extractGqlError(e, 'Failed to read the node'));
    }
    // The page acts on ITS rows: a node outside this org's memories is not one,
    // whatever the caller may write elsewhere. Reported as not-found, the same
    // answer as a node that does not exist, so the list is no existence probe.
    const memoryIds = node ? await orgMemoryIds(locals.token, params.id) : [];
    if (!node || !memoryIds.includes(node.memoryId)) return exportFail(404, nodeId, 'not-found');
    // The page lists runnable nodes only, and the server exports nothing else
    // (`skill-not-runnable`). A node un-marked since the list loaded is refused
    // here rather than given a declaration that can never export.
    if (!node.isRunnable) return exportFail(409, nodeId, 'not-runnable');

    const result = toggleSkillExport(node.properties, enable, {
      name: defaultSkillName(node.loc ?? '', node.name ?? '', node.id),
      description: (node.description ?? '').trim(),
    });
    if (result.kind === 'divergent') return exportFail(409, nodeId, 'divergent');
    if (result.kind === 'unchanged') return { exportSaved: { nodeId } };

    // ONLY properties: `UpdateNodeInput` preserves every omitted field, and the
    // node is already runnable, so no governance signal is touched.
    const input = { memoryId: node.memoryId, loc: node.loc, properties: result.properties };
    try {
      assertNodeUpdateDoor(node, input);
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      if (e instanceof NoNodeDoorError) return exportFail(409, nodeId, 'no-door', e.message);
      const text = extractGqlError(e, 'Failed to save');
      // #588 / server#1286: a memory-schema verdict — a strict collection, or
      // one declaring `exports` as a scalar field, refuses the declaration.
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') return exportFail(400, nodeId, 'rejected', text);
      return exportFail(500, nodeId, 'failed', text);
    }
    return { exportSaved: { nodeId } };
  },
};
