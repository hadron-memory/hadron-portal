import { error, fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_EDGE_MUTATION, EDGE_HOST_NODE_QUERY, UPDATE_EDGE_MUTATION } from '$lib/server/queries';
import { buildFlowCanvas, edgeRoutes } from '$lib/flow/canvas';
import type { FlowCanvasNodeInput, FlowEdgeDetail } from '$lib/flow/canvas';
import {
  flowEdgePanelDefaults,
  flowEdgePanelSchema,
  parseValidatedPanelCondition,
  parseValidatedPanelPriority,
} from '$lib/flow/edge-panel-form';
import { extractionSpecOf } from '$lib/flow/fields';
import type { FlowGraphNodeInput } from '$lib/flow/fields';
import { buildRoutingName, nextFreeRoutingIndex, routingOrder } from '$lib/flow/routing';
import { t } from '$lib/i18n/t';
import type { NodeEdge } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

type FlowEdgePanelForm = Infer<typeof flowEdgePanelSchema, 'zod4'>;

const flowEdgePanelFormAdapter = zod4(flowEdgePanelSchema);

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
// generous flow while bounding this page to 40 node reads (one parallel
// batch per BFS level — every panel save/create invalidates this load, so
// latency must scale with flow DEPTH, not node count × RTT).
const FLOW_NODES_MAX = 40;
const REFERENCE_NODES_MAX = 20;

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const client = gqlClient(locals.token);

  // Overlap the shared-layout load with the focus-node fetch (BFS level 0),
  // as the edge editor page does — this load re-runs on every panel save.
  // The fetch is settled (not awaited raw) so a failure can't surface before
  // the consumer-mode guard has had the chance to redirect.
  const [parentData, focusRes] = await Promise.all([
    parent(),
    client
      .request<{ node: FlowHostNode | null }>(EDGE_HOST_NODE_QUERY, { id: params.nodeId })
      .then(
        (res) => ({ ok: true as const, res }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
  ]);
  await requireNonConsumer(async () => parentData);
  if (!focusRes.ok) throw focusRes.err;

  const focus = focusRes.res.node;
  if (!focus) error(404, `Node not found: ${params.nodeId}`);

  // #237-style URL correction, as on the edge editor page.
  if (focus.memoryId !== params.id) {
    redirect(303, `/app/memories/${focus.memoryId}/nodes/${params.nodeId}/flow`);
  }

  const fetched = new Map<string, FlowHostNode>([[params.nodeId, focus]]);
  const attempted = new Set<string>();
  let truncated = false;

  const routedNeighborsOf = (node: FlowHostNode): string[] => {
    const out: string[] = [];
    for (const e of node.outgoingEdges) {
      // e.target is typed non-null but a deleted/unreadable endpoint can
      // surface as null at runtime — skip rather than crash the page.
      if (e.target && edgeRoutes(e, node.loc) && !fetched.has(e.target.id)) {
        out.push(e.target.id);
      }
    }
    for (const e of node.incomingEdges) {
      if (e.source && edgeRoutes(e, e.source.loc) && !fetched.has(e.source.id)) {
        out.push(e.source.id);
      }
    }
    return out;
  };

  // BFS one frontier level at a time, each level fetched in a single
  // Promise.all. Only SUCCESSFUL fetches count against FLOW_NODES_MAX — a
  // failed/deleted neighbor frees its slot — and candidates beyond the cap
  // carry over to the next round ahead of deeper discoveries, so nodes
  // closer to the focus keep priority.
  let frontier = routedNeighborsOf(focus);
  while (frontier.length > 0) {
    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const id of frontier) {
      if (fetched.has(id) || attempted.has(id) || seen.has(id)) continue;
      seen.add(id);
      candidates.push(id);
    }
    if (candidates.length === 0) break;

    const remaining = FLOW_NODES_MAX - fetched.size;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const batch = candidates.slice(0, remaining);
    for (const id of batch) attempted.add(id);

    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await client.request<{ node: FlowHostNode | null }>(EDGE_HOST_NODE_QUERY, {
            id,
          });
          return res.node;
        } catch (err) {
          // Best-effort beyond the focus node: an unreadable neighbor shrinks
          // the canvas, it doesn't 500 the page.
          console.warn(`[flow-canvas] neighbor fetch failed for ${id}:`, err);
          return null;
        }
      }),
    );

    // Over-cap candidates retry next round, BEFORE this level's discoveries.
    const next = candidates.slice(remaining);
    for (let i = 0; i < batch.length; i++) {
      const node = results[i];
      if (!node) continue; // deleted or unreadable — its slot stays free
      fetched.set(batch[i], node);
      next.push(...routedNeighborsOf(node));
    }
    frontier = next;
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

  // Editable detail per displayed edge (#510) — the side panel's payload.
  // FlowEdgeDetail is a superset of FlowCanvasEdgeInput, so this one pass
  // also feeds buildFlowCanvas.
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

  // Inputs for the panel's condition-builder field picker, computed LAZILY on
  // the client (collectFlowFieldsFor) for the one open panel — only each flow
  // node's extraction spec ships, not full node data and not a precomputed
  // O(nodes × upstream) label map. Upstream coverage is the whole fetched
  // graph (deeper than the edge editor's 2 levels), via edgeDetails. Entries
  // are stripped to the keys the picker uses: extractionSpecOf filters
  // malformed entries but keeps extra author keys, which would bloat this
  // per-save payload.
  const fieldNodes: FlowGraphNodeInput[] = [...fetched.values()].map((n) => ({
    id: n.id,
    loc: n.loc,
    name: n.name,
    extractionSpec: extractionSpecOf(n.data).map(({ field, description, shape }) => ({
      field,
      description,
      shape,
    })),
  }));
  const edgeForms = Object.fromEntries(
    await Promise.all(
      edgeDetails.map(async (edge) => [
        edge.id,
        await superValidate<FlowEdgePanelForm>(
          flowEdgePanelDefaults(edge),
          flowEdgePanelFormAdapter,
          { errors: false },
        ),
      ]),
    ),
  );

  return {
    canvas: buildFlowCanvas(nodeInputs, edgeDetails),
    edgeDetails,
    edgeForms,
    fieldNodes,
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
    const form = await superValidate<FlowEdgePanelForm>(fd, flowEdgePanelFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || null;
    const priority = parseValidatedPanelPriority(form.data.priority);
    const condition = parseValidatedPanelCondition(form.data.condition);

    try {
      await gqlClient(locals.token).request(UPDATE_EDGE_MUTATION, {
        edgeId,
        name,
        condition,
        priority,
      });
      return message(form, { type: 'success', text: t('flow.panel.saved', 'Edge saved.') });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update edge') }, { status: 500 });
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

    // The next free numeric index alone does NOT guarantee last place: an
    // index-less sibling (`next`, `next.<label>`) sorts AFTER every numeric
    // index, so the new condition-less edge would become the fall-through and
    // cut that sibling off. Simulate the walker's order with a probe and bump
    // the new edge's priority past every routing sibling when needed.
    const probe = { name, loc: `${host.loc}:${name}:probe`, priority: 0, condition: null };
    const ordered = routingOrder([...host.outgoingEdges, probe], host.loc);
    let priority: number | undefined;
    if (ordered.length > 0 && ordered[ordered.length - 1].edge !== probe) {
      priority =
        Math.max(...ordered.filter((o) => o.edge !== probe).map((o) => o.edge.priority ?? 0)) + 1;
    }

    try {
      const res = await client.request<{ createEdge: { id: string } }>(CREATE_EDGE_MUTATION, {
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        name,
        // Absent variable = server default; only sent when a bump is needed.
        ...(priority !== undefined ? { priority } : {}),
      });
      return { created: true, edgeId: res.createEdge.id };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to create edge') });
    }
  },
};
