import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { NODE_PROPERTIES_READ_QUERY, RUNNABLE_NODES_QUERY, ORG_TASK_MEMORY_IDS_QUERY } from '$lib/server/queries';
// #868: the write goes through the door chooser; naming a mutation document
// here directly is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument, NoNodeDoorError } from '$lib/server/nodeKindDoor';
import { defaultSkillName, legacySuppliesClaude, taskExport, toggleSkillExport } from '$lib/skill-export';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import { orgTaskMemoryIds } from '$lib/server/org-task-memories';
import type { Actions, PageServerLoad } from './$types';
import { limitRefusal } from '$lib/server/limit-refusal';

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

async function orgMemoryIds(token: string | null | undefined, orgId: string) {
  // #845: the layout carries chrome only; this tab needs the full org.
  // #1689: plus its system-class memories, which `Organization.memories` omits.
  return orgTaskMemoryIds(token, orgId, ORG_TASK_MEMORY_IDS_QUERY);
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { ids: memoryIds, systemFailed } = await orgMemoryIds(locals.token, params.id);

  // No org memories → no tasks. Critically, do NOT call nodes() with an empty
  // memoryIds set: the server treats "omit memoryIds" as "every accessible
  // memory", so an empty org would otherwise leak the global task list.
  if (memoryIds.length === 0) return { tasks: [], failed: false, truncated: false, scopeIncomplete: systemFailed };

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

  // `failed` is the NODE query; `scopeIncomplete` is the system-memory lookup.
  // Different causes, different messages: the second still lists everything it
  // could reach, so the page warns instead of blaming the node query.
  return { tasks, failed, truncated, scopeIncomplete: systemFailed };
};

/**
 * Why a row's checkbox did not save. A CODE, not prose: server routes here do
 * not localize, so the page maps each code through `t()`. `detail` carries the
 * server's own words where it gave some.
 */
export type ExportFailure = 'unauthenticated' | 'invalid' | 'not-found' | 'not-runnable' | 'divergent' | 'legacy' | 'no-door' | 'rejected' | 'failed';

function exportFail(status: number, nodeId: string, code: ExportFailure, detail?: string) {
  return fail(status, { exportFailed: { nodeId, code, detail: detail ?? null } });
}

export const actions: Actions = {
  /**
   * #879 — one row's checkbox. The form carries the node id and the state the
   * user asked for, both LITERALS rendered into the row's own form, so nothing
   * is written on click (`hrn:node:hadronmemory.com:hadron-portal:review:submitted-value-must-not-be-written-on-click`).
   *
   * The new properties are computed from a FRESH read, never from the page:
   * `updateTaskNode` replaces `properties` whole, so writing back the page's
   * copy would undo any edit made since the list loaded — in another tab, the
   * CLI, or the node's own edit page.
   *
   * KNOWN GAP (portal#890): a write landing BETWEEN this read and the update is
   * still lost. The atomic per-host merge exists (`updateNodeProperties`,
   * server#1227) but is refused on every node this page lists — they are all
   * runnable, hence governed tasks, and that mutation is the generic door
   * (measured on server main: ROLE_GOVERNED). Closing it needs a task-door
   * merge on the server; reported, not worked around here.
   */
  setExport: async ({ request, params, locals }) => {
    // Actions do not run the /app layout's sign-in redirect, so an anonymous
    // POST would reach the API with no token. Refused here, explicitly.
    if (!locals.token) return fail(401, { exportFailed: { nodeId: '', code: 'unauthenticated', detail: null } });
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
      ({ node } = await client.request<{ node: MemoryNode | null }>(NODE_PROPERTIES_READ_QUERY, { ref: nodeId }));
    } catch (e: unknown) {
      return exportFail(500, nodeId, 'failed', extractGqlError(e, 'Failed to read the node', ["BAD_USER_INPUT"]));
    }
    // The page acts on ITS rows: a node outside this org's memories is not one,
    // whatever the caller may write elsewhere. Reported as not-found, the same
    // answer as a node that does not exist, so the list is no existence probe.
    const scope = node ? await orgMemoryIds(locals.token, params.id) : null;
    if (!node || !scope?.ids.includes(node.memoryId)) {
      // The system-memory lookup failing means "not found" is a guess: the node
      // may be a role agent's task whose memory we could not list. Say so.
      if (node && scope?.systemFailed) {
        return exportFail(503, nodeId, 'failed', 'The organization’s system memories could not be checked. Try again shortly.');
      }
      return exportFail(404, nodeId, 'not-found');
    }
    // The page lists runnable nodes only, and the server exports nothing else
    // (`skill-not-runnable`). A node un-marked since the list loaded is refused
    // here rather than given a declaration that can never export.
    if (!node.isRunnable) return exportFail(409, nodeId, 'not-runnable');
    // #906: Claude's export comes from a retired top-level key. The
    // `exports.claudeSkill` this would write wins over it on the server, a
    // silent override. The row offers no checkbox; this refuses a stale page's
    // POST too. Beside a modern Claude declaration the legacy key has no
    // effect, and the toggle is allowed (@codex on #907).
    if (legacySuppliesClaude(node.properties)) return exportFail(409, nodeId, 'legacy');

    const result = toggleSkillExport(node.properties, enable, {
      name: defaultSkillName(node.loc ?? '', node.name ?? '', node.id),
      description: (node.description ?? '').trim(),
    });
    if (result.kind === 'divergent') return exportFail(409, nodeId, 'divergent');
    if (result.kind === 'unchanged') return { exportSaved: { nodeId } };

    // ONLY properties: `UpdateNodeInput` preserves every omitted field, and the
    // node is already runnable, so no governance signal is touched.
    const input = { memoryRef: node.memoryId, loc: node.loc, properties: result.properties };
    try {
      assertNodeUpdateDoor(node, input);
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      if (e instanceof NoNodeDoorError) return exportFail(409, nodeId, 'no-door', e.message);
      const limit = limitRefusal(e, { link: false });
      if (limit) return exportFail(limit.status, nodeId, 'rejected', limit.text);
      const text = extractGqlError(e, 'Failed to save', ["BAD_USER_INPUT"]);
      // #588 / server#1286: a memory-schema verdict — a strict collection, or
      // one declaring `exports` as a scalar field, refuses the declaration.
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') return exportFail(400, nodeId, 'rejected', text);
      return exportFail(500, nodeId, 'failed', text);
    }
    return { exportSaved: { nodeId } };
  },
};
