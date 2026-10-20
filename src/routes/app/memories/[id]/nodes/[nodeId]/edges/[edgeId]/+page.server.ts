import { error, fail, redirect } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
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
import { t } from '$lib/i18n/t';
import type { NodeEdge } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { edgeDeleteSchema, edgeUpdateSchema, parseEdgeDataText } from './schema';

type EdgeUpdateForm = Infer<typeof edgeUpdateSchema, 'zod4'>;
type EdgeDeleteForm = Infer<typeof edgeDeleteSchema, 'zod4'>;

const edgeUpdateFormAdapter = zod4(edgeUpdateSchema);
const edgeDeleteFormAdapter = zod4(edgeDeleteSchema);

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
        }>(FLOW_UPSTREAM_NODE_QUERY, { ref: e.source!.id });
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

function formDefaults(edge: NodeEdge): EdgeUpdateForm {
  return {
    _kind: 'updateEdge',
    name: edge.name ?? '',
    description: edge.description ?? '',
    isRunnable: edge.isRunnable ?? false,
    priority: String(edge.priority ?? 0),
    condition: JSON.stringify(edge.condition ?? null),
    data: edge.data != null ? JSON.stringify(edge.data, null, 2) : '',
  };
}

function parseValidatedPriority(value: string): number {
  const parsed = parsePriorityField(value);
  if (parsed.ok) return parsed.value;
  throw new Error(`Validated priority failed to parse: ${parsed.error}`);
}

function parseValidatedCondition(value: string): unknown {
  const parsed = parseConditionField(value);
  if (parsed.ok) return parsed.value;
  throw new Error(`Validated condition failed to parse: ${parsed.error}`);
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  // The host fetch overlaps parent() but is settled (not awaited raw) so a
  // failure can't surface before the consumer-mode guard redirects.
  const [parentData, hostRes] = await Promise.all([
    parent(),
    gqlClient(locals.token)
      .request<{ node: HostNode | null }>(EDGE_HOST_NODE_QUERY, { ref: params.nodeId })
      .then(
        (res) => ({ ok: true as const, res }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
  ]);
  await requireNonConsumer(async () => parentData);
  if (!hostRes.ok) throw hostRes.err;

  const host = hostRes.res.node;
  if (!host) error(404, `Node not found: ${params.nodeId}`);
  const edge = host.outgoingEdges.find((e) => e.id === params.edgeId);
  if (!edge) error(404, `Edge not found: ${params.edgeId}`);

  // #237-style URL correction: the route is scoped by memory id, but the host
  // node resolves by PK alone. Redirect a stale/mismatched URL to the canonical
  // one so the page renders under the right memory's chrome.
  if (host.memoryId !== params.id) {
    redirect(303, `/app/memories/${host.memoryId}/nodes/${params.nodeId}/edges/${params.edgeId}`);
  }

  const [flowFields, form, deleteForm] = await Promise.all([
    loadFlowFields(locals.token, host),
    superValidate<EdgeUpdateForm>(
      formDefaults(edge),
      edgeUpdateFormAdapter,
      { errors: false },
    ),
    superValidate<EdgeDeleteForm>(
      {},
      edgeDeleteFormAdapter,
      { errors: false },
    ),
  ]);

  return { host, edge, flowFields, form, deleteForm };
};

/**
 * portal#1142 P0a: an edge derived from an include tag (hadron-server#2040) is
 * refused with INCLUDE_EDGE_DERIVED, shown with the server's words and the way
 * forward. Any other GraphQL failure shows the server's first error message
 * rather than graphql-request's raw ClientError text, which carries the query
 * and variables (the #468 rule `extractGqlError` exists for).
 */
function edgeWriteFailure<F extends Parameters<typeof message>[0]>(form: F, e: unknown, fallback: string) {
  const include = includeRefusalOf(e);
  if (include) return message(form, { type: 'error', text: includeRefusalText(include) }, { status: 409 });
  // A ClientError with no GraphQL message (a 503, say) carries only
  // graphql-request's own text, which embeds the query and variables: never
  // show it, use the fallback (Gene's blind P2 on #1155). A plain Error keeps
  // its message, as before.
  const serverMessage = e instanceof ClientError ? e.response?.errors?.[0]?.message : undefined;
  const text = e instanceof ClientError ? (serverMessage || fallback) : extractGqlError(e, fallback);
  return message(form, { type: 'error', text }, { status: 500 });
}

export const actions: Actions = {
  // Edits every property except loc (the edge's identity — renaming it would
  // re-address the edge; out of scope per #350). `updateEdge` treats a null
  // condition/data as CLEAR and a null priority as "keep" — so we always send
  // an explicit priority, and send null for an emptied condition/data to clear.
  update: async ({ request, params, locals }) => {
    const form = await superValidate<EdgeUpdateForm>(
      await request.formData(),
      edgeUpdateFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || null;
    const description = form.data.description || null;

    // The schema already validates these parser-backed fields; parse again only
    // to produce the GraphQL payload values.
    const priority = parseValidatedPriority(form.data.priority);
    const condition = parseValidatedCondition(form.data.condition);
    const dataVal = parseEdgeDataText(form.data.data);

    try {
      await gqlClient(locals.token).request(UPDATE_EDGE_MUTATION, {
        edgeRef: params.edgeId,
        name,
        description,
        isRunnable: form.data.isRunnable,
        condition,
        priority,
        data: dataVal,
      });
      return message(form, { type: 'success', text: t('edge-editor.saved', 'Edge saved.') });
    } catch (e: unknown) {
      return edgeWriteFailure(form, e, 'Failed to update edge');
    }
  },

  delete: async ({ request, params, locals }) => {
    const form = await superValidate<EdgeDeleteForm>(
      await request.formData(),
      edgeDeleteFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(DELETE_EDGE_MUTATION, { edgeRef: params.edgeId });
    } catch (e: unknown) {
      return edgeWriteFailure(form, e, 'Failed to delete edge');
    }
    // Back to the source node — its Edges tab is where the edge lived.
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  },
};
