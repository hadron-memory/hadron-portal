import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { EDGE_HOST_NODE_QUERY } from '$lib/server/queries';
import { buildFlowCanvas, edgeRoutes } from '$lib/flow/canvas';
import type { FlowCanvasEdgeInput, FlowCanvasNodeInput } from '$lib/flow/canvas';
import type { NodeEdge } from '$lib/types';
import type { PageServerLoad } from './$types';

// Read-only flow canvas (spike; #478 left "visual flow canvas" open).
// Walks the flow graph in BOTH directions from the focus node — outgoing
// routing edges via each node's outgoingEdges, upstream via incomingEdges —
// fetching each flow node with EDGE_HOST_NODE_QUERY (the only query that
// selects edge condition/priority). Edges are collected exclusively from
// fetched nodes' outgoingEdges, so every displayed edge has full fidelity
// and appears exactly once (an edge is owned by its source node).

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
      if (edgeRoutes(e, node.loc) && !fetched.has(e.target.id)) queue.push(e.target.id);
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
    n.outgoingEdges.map((e) => ({
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

  return {
    canvas: buildFlowCanvas(nodeInputs, edgeInputs),
    focusId: params.nodeId,
    focusName: focus.name || focus.loc,
    memoryId: focus.memoryId,
    truncated,
    referencesDropped,
  };
};
