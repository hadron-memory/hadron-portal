import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  EDGE_HOST_NODE_QUERY,
  FLOW_UPSTREAM_NODE_QUERY,
  UPDATE_EDGE_MUTATION,
  DELETE_EDGE_MUTATION,
} from '$lib/server/queries';
import { parseConditionField, parsePriorityField } from '$lib/flow/edge-form';
import { collectFlowFields, type FlowFieldNode } from '$lib/flow/fields';
import { isRoutingName, routingNameOf } from '$lib/flow/routing';
import type { NodeEdge } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// The edge detail page (#350). The server has no single-edge query, so we load
// the edge's HOST node (= its source — every edge is owned by its source node)
// by PK and pick the edge out of outgoingEdges. The route nodeId is therefore
// the source node's id (the node page's Edges tab builds the link that way).
interface UpstreamEdge {
  name: string | null;
  loc: string;
  source: { id: string; loc: string; name: string; data: unknown } | null;
}

interface HostNode {
  id: string;
  memoryId: string;
  loc: string;
  name: string;
  data: unknown;
  memory: { id: string; urn: string; name: string } | null;
  outgoingEdges: NodeEdge[];
  incomingEdges: UpstreamEdge[];
}

// Level-2 upstream fan-out cap — the field picker is best-effort (#478);
// a hub node with dozens of inbound flow edges shouldn't stall the page.
const UPSTREAM_FETCH_MAX = 8;

/**
 * Envelope fields for the condition builder: the host's own extraction
 * fields plus upstream flow nodes' (2 levels). Level 1 rides the host
 * query; level 2 is fetched here per upstream node, best-effort — a
 * failure only shrinks the picker, never the page.
 */
async function loadFlowFields(token: string | null | undefined, host: HostNode) {
  const upstream = host.incomingEdges
    .filter((e) => e.source && isRoutingName(routingNameOf(e, e.source.loc)))
    .slice(0, UPSTREAM_FETCH_MAX);

  const level2 = await Promise.all(
    upstream.map(async (e) => {
      try {
        const res = await gqlClient(token).request<{
          node: { incomingEdges: UpstreamEdge[] } | null;
        }>(FLOW_UPSTREAM_NODE_QUERY, { id: e.source!.id });
        return res.node?.incomingEdges ?? [];
      } catch (err) {
        console.warn(`[edge-editor] upstream fetch failed for ${e.source!.id}:`, err);
        return [];
      }
    }),
  );

  const tree: FlowFieldNode = {
    loc: host.loc,
    name: host.name,
    data: host.data,
    incomingEdges: upstream.map((e, i) => ({
      name: e.name,
      loc: e.loc,
      source: e.source && {
        loc: e.source.loc,
        name: e.source.name,
        data: e.source.data,
        incomingEdges: level2[i].map((u) => ({
          name: u.name,
          loc: u.loc,
          source: u.source && { loc: u.source.loc, name: u.source.name, data: u.source.data },
        })),
      },
    })),
  };
  return collectFlowFields(tree);
}

// Mirrors the node Data tab cap — keeps a pathological paste from hitting the
// adapter-node body limit with an opaque error.
const DATA_MAX = 262144; // 256 KB

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ node: HostNode | null }>(
      EDGE_HOST_NODE_QUERY, { id: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);

  const host = data.node;
  if (!host) error(404, `Node not found: ${params.nodeId}`);
  const edge = host.outgoingEdges.find((e) => e.id === params.edgeId);
  if (!edge) error(404, `Edge not found: ${params.edgeId}`);

  // #237-style URL correction: the route is scoped by memory id, but the host
  // node resolves by PK alone. Redirect a stale/mismatched URL to the canonical
  // one so the page renders under the right memory's chrome.
  if (host.memoryId !== params.id) {
    redirect(303, `/app/memories/${host.memoryId}/nodes/${params.nodeId}/edges/${params.edgeId}`);
  }

  const flowFields = await loadFlowFields(locals.token, host);

  return { host, edge, flowFields };
};

export const actions: Actions = {
  // Edits every property except loc (the edge's identity — renaming it would
  // re-address the edge; out of scope per #350). `updateEdge` treats a null
  // condition/data as CLEAR and a null priority as "keep" — so we always send
  // an explicit priority, and send null for an emptied condition/data to clear.
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const isRunnable = fd.get('isRunnable') === 'true';

    const priority = parsePriorityField(fd.get('priority'));
    if (!priority.ok) return fail(400, { error: priority.error });

    const condition = parseConditionField(fd.get('condition'));
    if (!condition.ok) return fail(400, { error: condition.error });

    // Free-form JSON payload. Empty → null (clear). Non-empty must parse.
    const dataRaw = String(fd.get('data') ?? '').trim();
    let dataVal: unknown = null;
    if (dataRaw !== '') {
      if (dataRaw.length > DATA_MAX) {
        return fail(400, { error: `JSON too large (max ${DATA_MAX / 1024} KB)` });
      }
      try {
        dataVal = JSON.parse(dataRaw);
      } catch (e) {
        return fail(400, { error: e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON' });
      }
    }

    try {
      await gqlClient(locals.token).request(UPDATE_EDGE_MUTATION, {
        edgeId: params.edgeId,
        name,
        description,
        isRunnable,
        condition: condition.value,
        priority: priority.value,
        data: dataVal,
      });
      return { saved: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update edge' });
    }
  },

  delete: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(DELETE_EDGE_MUTATION, { edgeId: params.edgeId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete edge' });
    }
    // Back to the source node — its Edges tab is where the edge lived.
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  },
};
