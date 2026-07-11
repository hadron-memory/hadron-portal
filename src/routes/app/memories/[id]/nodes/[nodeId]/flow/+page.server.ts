import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_EDGE_MUTATION, EDGE_HOST_NODE_QUERY, UPDATE_EDGE_MUTATION } from '$lib/server/queries';
import { buildFlowCanvas, edgeRoutes } from '$lib/flow/canvas';
import type { FlowCanvasEdgeInput, FlowCanvasNodeInput, FlowEdgeDetail } from '$lib/flow/canvas';
import { collectFlowFieldsByNode } from '$lib/flow/fields';
import { buildRoutingName, nextFreeRoutingIndex } from '$lib/flow/routing';
import type { NodeEdge } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// Flow canvas (#509 spike, editing per #510). Walks the flow graph in BOTH
// directions from the focus node — outgoing routing edges via each node's
// outgoingEdges, upstream via incomingEdges — fetching each flow node with
// EDGE_HOST_NODE_QUERY (the only query that selects edge condition/priority).
// Edges are collected exclusively from fetched nodes' outgoingEdges, so every
// displayed edge has full fidelity and appears exactly once (an edge is owned
// by its source node).

interface FlowHostNode {
  id: string;
  memoryId: string;
  loc: string;
  name: string;
  data: unknown;
  memory: { id: string; urn: string; name: string } | null;
  outgoingEdges: NodeEdge[];
  incomingEdges: Array<{
    name: string | null;
    loc: string;
    source: { id: string; loc: string; name: string; data: unknown } | null;
  }>;
}

// Caps: RUN_MAX_HOPS is 50 but real flows are 3–10 hops; 40 nodes covers a
// generous flow while bounding this page to 40 sequential-ish node reads.
const FLOW_NODES_MAX = 40;
const REFERENCE_NODES_MAX = 20;

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const parentData = await parent();
  await requireNonConsumer(async () => parentData);

  const client = gqlClient(locals.token);
  const fetched = new Map<string, FlowHostNode>();
  const queue = [params.nodeId];
  let truncated = false;

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (fetched.has(id)) continue;
    if (fetched.size >= FLOW_NODES_MAX) {
      truncated = true;
      break;
    }
    let node: FlowHostNode | null;
    try {
      const res = await client.request<{ node: FlowHostNode | null }>(EDGE_HOST_NODE_QUERY, { id });
      node = res.node;
    } catch (err) {
      // Best-effort beyond the focus node: an unreadable neighbor shrinks
      // the canvas, it doesn't 500 the page.
      if (id === params.nodeId) throw err;
      console.warn(`[flow-canvas] neighbor fetch failed for ${id}:`, err);
      continue;
    }
    if (!node) {
      if (id === params.nodeId) error(404, `Node not found: ${id}`);
      continue;
    }
    fetched.set(id, node);

    for (const e of node.outgoingEdges) {
      // e.target is typed non-null but a deleted/unreadable endpoint can
      // surface as null at runtime — skip rather than crash the page.
      if (e.target && edgeRoutes(e, node.loc) && !fetched.has(e.target.id)) queue.push(e.target.id);
    }
    for (const e of node.incomingEdges) {
      if (e.source && edgeRoutes(e, e.source.loc) && !fetched.has(e.source.id)) {
        queue.push(e.source.id);
      }
    }
  }

  const focus = fetched.get(params.nodeId);
  if (!focus) error(404, `Node not found: ${params.nodeId}`);

  // #237-style URL correction, as on the edge editor page.
  if (focus.memoryId !== params.id) {
    redirect(303, `/app/memories/${focus.memoryId}/nodes/${params.nodeId}/flow`);
  }

  const nodeInputs: FlowCanvasNodeInput[] = [...fetched.values()].map((n) => ({
    id: n.id,
    loc: n.loc,
    name: n.name,
    data: n.data,
    kind: 'flow',
  }));

  // Non-routing edge targets become reference nodes — shown, never walked.
  let referencesDropped = 0;
  for (const n of fetched.values()) {
    for (const e of n.outgoingEdges) {
      if (!e.target) continue;
      if (edgeRoutes(e, n.loc) || fetched.has(e.target.id)) continue;
      if (nodeInputs.some((existing) => existing.id === e.target.id)) continue;
      if (nodeInputs.length - fetched.size >= REFERENCE_NODES_MAX) {
        referencesDropped++;
        continue;
      }
      nodeInputs.push({ id: e.target.id, loc: e.target.loc, name: e.target.name, kind: 'reference' });
    }
  }

  const edgeInputs: FlowCanvasEdgeInput[] = [...fetched.values()].flatMap((n) =>
    n.outgoingEdges
      .filter((e) => e.target)
      .map((e) => ({
        id: e.id,
        name: e.name,
        loc: e.loc,
        priority: e.priority,
        condition: e.condition,
        sourceId: n.id,
        sourceLoc: n.loc,
        targetId: e.target.id,
      })),
  );

  // Editable detail per displayed edge (#510) — the side panel's payload.
  const edgeDetails: FlowEdgeDetail[] = [...fetched.values()].flatMap((n) =>
    n.outgoingEdges
      .filter((e) => e.target)
      .map((e) => ({
        id: e.id,
        name: e.name,
        loc: e.loc,
        priority: e.priority ?? null,
        condition: e.condition ?? null,
        sourceId: n.id,
        sourceLoc: n.loc,
        sourceName: n.name,
        targetId: e.target.id,
        targetLoc: e.target.loc,
        targetName: e.target.name,
      })),
  );

  // Envelope fields for the panel's condition builder, keyed by source node.
  // The canvas already fetched every flow node's data, so upstream coverage
  // is the whole fetched graph (deeper than the edge editor's 2 levels).
  const flowFieldsByNode = collectFlowFieldsByNode(
    [...fetched.values()].map((n) => ({ id: n.id, loc: n.loc, name: n.name, data: n.data })),
    edgeInputs.map((e) => ({ name: e.name, loc: e.loc, sourceId: e.sourceId, targetId: e.targetId })),
  );

  return {
    canvas: buildFlowCanvas(nodeInputs, edgeInputs),
    edgeDetails,
    flowFieldsByNode,
    focusId: params.nodeId,
    focusName: focus.name || focus.loc,
    memoryId: focus.memoryId,
    truncated,
    referencesDropped,
  };
};

export const actions: Actions = {
  // Saves the side panel's editable subset: name (routing or free-form),
  // priority, condition. Variables the panel doesn't edit (description,
  // isRunnable, data) are OMITTED from the mutation so the server keeps
  // them — updateEdge treats an absent variable as "keep" and an explicit
  // null as CLEAR (same contract the conversations editor relies on).
  updateEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const edgeId = String(fd.get('edgeId') ?? '').trim();
    if (!edgeId) return fail(400, { error: 'Missing edge id' });
    const name = String(fd.get('name') ?? '').trim() || null;

    // Number() + isInteger (not parseInt), as on the edge editor page:
    // parseInt('1e2') === 1 and '1.5' → 1 both silently mis-parse.
    const priorityRaw = String(fd.get('priority') ?? '').trim();
    const priority = priorityRaw === '' ? 0 : Number(priorityRaw);
    if (!Number.isInteger(priority)) {
      return fail(400, { edgeId, error: 'Priority must be a whole number' });
    }

    // Hidden field carries the ConditionBuilder's serialized JSONLogic, or
    // the literal "null" when the condition is empty (always-fires → CLEAR).
    const conditionRaw = String(fd.get('condition') ?? 'null');
    let condition: unknown;
    try {
      condition = JSON.parse(conditionRaw);
    } catch {
      return fail(400, { edgeId, error: 'Invalid condition expression' });
    }

    try {
      await gqlClient(locals.token).request(UPDATE_EDGE_MUTATION, {
        edgeId,
        name,
        condition,
        priority,
      });
      return { saved: true, edgeId };
    } catch (e: unknown) {
      return fail(500, { edgeId, error: extractGqlError(e, 'Failed to update edge') });
    }
  },

  // Drag-to-connect (#510): creates a routing edge named next.<index> with
  // the source's next free index, so the new branch lands last in the firing
  // order — refine order/label/condition in the side panel afterwards.
  createEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const sourceId = String(fd.get('sourceId') ?? '').trim();
    const targetId = String(fd.get('targetId') ?? '').trim();
    if (!sourceId || !targetId) return fail(400, { error: 'Missing connection endpoints' });
    if (sourceId === targetId) {
      return fail(400, { error: 'A node cannot route to itself' });
    }

    const client = gqlClient(locals.token);
    let host: FlowHostNode | null;
    try {
      const res = await client.request<{ node: FlowHostNode | null }>(EDGE_HOST_NODE_QUERY, {
        id: sourceId,
      });
      host = res.node;
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to load the source node') });
    }
    if (!host) return fail(404, { error: `Node not found: ${sourceId}` });

    const name = buildRoutingName(nextFreeRoutingIndex(host.outgoingEdges, host.loc), '');
    try {
      const res = await client.request<{ createEdge: { id: string } }>(CREATE_EDGE_MUTATION, {
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        name,
      });
      return { created: true, edgeId: res.createEdge.id };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to create edge') });
    }
  },
};
