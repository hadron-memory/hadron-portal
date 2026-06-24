import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { EDGE_HOST_NODE_QUERY, UPDATE_EDGE_MUTATION, DELETE_EDGE_MUTATION } from '$lib/server/queries';
import type { NodeEdge } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// The edge detail page (#350). The server has no single-edge query, so we load
// the edge's HOST node (= its source — every edge is owned by its source node)
// by PK and pick the edge out of outgoingEdges. The route nodeId is therefore
// the source node's id (the References tab builds the link that way).
interface HostNode {
  id: string;
  memoryId: string;
  loc: string;
  name: string;
  memory: { id: string; urn: string; name: string } | null;
  outgoingEdges: NodeEdge[];
}

// Mirrors the node Data tab cap — keeps a pathological paste from hitting the
// adapter-node body limit with an opaque error.
const DATA_MAX = 262144; // 256 KB

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ nodeById: HostNode | null }>(
      EDGE_HOST_NODE_QUERY, { id: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);

  const host = data.nodeById;
  if (!host) throw new Error(`Node not found: ${params.nodeId}`);
  const edge = host.outgoingEdges.find((e) => e.id === params.edgeId);
  if (!edge) throw new Error(`Edge not found: ${params.edgeId}`);

  // #237-style URL correction: the route is scoped by memory id, but the host
  // node resolves by PK alone. Redirect a stale/mismatched URL to the canonical
  // one so the page renders under the right memory's chrome.
  if (host.memoryId !== params.id) {
    redirect(303, `/app/memories/${host.memoryId}/nodes/${params.nodeId}/edges/${params.edgeId}`);
  }

  return { host, edge };
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

    const priorityRaw = String(fd.get('priority') ?? '').trim();
    const priority = priorityRaw === '' ? 0 : parseInt(priorityRaw, 10);
    if (Number.isNaN(priority)) return fail(400, { error: 'Priority must be a whole number' });

    // Hidden field carries the ConditionBuilder's serialized JSONLogic, or the
    // literal "null" when the condition is empty (always-fires → CLEAR).
    const conditionRaw = String(fd.get('condition') ?? 'null');
    let condition: unknown;
    try {
      condition = JSON.parse(conditionRaw);
    } catch {
      return fail(400, { error: 'Invalid condition expression' });
    }

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
        condition,
        priority,
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
    // Back to the source node — its References tab is where the edge lived.
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  },
};
