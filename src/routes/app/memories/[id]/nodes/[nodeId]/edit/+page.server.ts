import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, UPDATE_NODE_MUTATION, MOVE_NODE_MUTATION } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { editNodeSchema } from './schema';

type EditNodeForm = Infer<typeof editNodeSchema, 'zod4'>;

const editNodeFormAdapter = zod4(editNodeSchema);

function formDefaults(node: MemoryNode): EditNodeForm {
  return {
    name: node.name,
    loc: node.loc,
    description: node.description ?? '',
    alias: node.alias ?? '',
    abstract: node.abstract ?? '',
    content: node.content ?? '',
    seq: node.seq ?? null,
    tags: (node.tags ?? []).join(', '),
    isRunnable: node.isRunnable ?? false,
    edges: JSON.stringify((node.outgoingEdges ?? []).map((e) => ({ targetId: e.target.id, name: e.name ?? '' }))),
  };
}

function parseEdgesPayload(value: string): { targetId: string; name: string }[] | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as { targetId: string; name: string }[];
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ node: MemoryNode | null }>(
    NODE_BY_ID_QUERY, { id: params.nodeId },
  );
  if (!data.node) throw new Error(`Node not found: ${params.nodeId}`);
  // #237: same URL-acceptance guard as the detail page. Without it, an
  // edit URL with a mismatched (gid, nodeId) would let the user save
  // changes into the foreign node while believing they edit the current
  // memory's row. Redirect to the correct edit URL so the destination
  // memory is consistent with the node's actual ownership.
  if (data.node.memoryId !== params.id) {
    redirect(303, `/app/memories/${data.node.memoryId}/nodes/${params.nodeId}/edit`);
  }
  const form = await superValidate<EditNodeForm>(
    formDefaults(data.node),
    editNodeFormAdapter,
    { errors: false },
  );
  return { node: data.node, form };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate<EditNodeForm>(
      await request.formData(),
      editNodeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);

    // Load current node to get its loc
    const { node: currentNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!currentNode) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

    const description = form.data.description || null;
    const alias = form.data.alias || null;
    // Empty/whitespace-only → null so the server clears the abstract rather
    // than storing an empty string (it normalizes the same way, but being
    // explicit keeps the mutation payload honest). Cap is enforced server-side.
    const abstract = form.data.abstract || null;
    const content = form.data.content || null;
    const tags = form.data.tags ? form.data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

    let edges: { targetId: string; name: string }[] | undefined;
    try {
      edges = parseEdgesPayload(form.data.edges);
    } catch {
      return message(form, { type: 'error', text: 'Edges payload was corrupt. Please refresh and try again.' }, { status: 400 });
    }

    // #237: route every mutation through the node's actual memoryId, not
    // the URL's gid. Form actions run BEFORE `load`, so the URL guard
    // above doesn't run on POST — a stale URL would otherwise commit
    // the user's edit into the wrong memory.
    // #564 (#501): moveNode takes sourceRef (the PK) + targetUrn composed
    // from the node's OWN memory urn — a stale URL can't redirect the move.
    // An occupied destination fails loudly with NODE_ALREADY_EXISTS.
    // Empty loc means "keep the current loc"; the page seeds loc in load, so
    // empty only appears on malformed/manual POSTs and should not move a node.
    const loc = form.data.loc && form.data.loc !== currentNode.loc ? form.data.loc : currentNode.loc;
    if (loc !== currentNode.loc) {
      if (!currentNode.memory?.urn) {
        return message(form, { type: 'error', text: 'Node has no memory URN to move by.' }, { status: 500 });
      }
      try {
        await client.request(MOVE_NODE_MUTATION, {
          sourceRef: currentNode.id,
          targetUrn: composeNodeUrn(currentNode.memory.urn, loc),
        });
      } catch (e: unknown) {
        // Occupied destination → 409 Conflict, matching the detail page +
        // the /api/nodes/move endpoint.
        const status = extractGqlErrorCode(e) === 'NODE_ALREADY_EXISTS' ? 409 : 500;
        const error = extractGqlError(e, 'Failed to move node');
        return status === 409
          ? setError(form, 'loc', error, { status })
          : message(form, { type: 'error', text: error }, { status });
      }
    }

    try {
      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          memoryId: currentNode.memoryId,
          loc,
          name: form.data.name,
          description,
          alias,
          abstract,
          content,
          seq: form.data.seq,
          tags,
          isRunnable: form.data.isRunnable,
          edges,
        },
      });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: e instanceof Error ? e.message : 'Failed to save' }, { status: 500 });
    }

    // Redirect to the actual memory's detail URL, not the URL's gid.
    redirect(303, `/app/memories/${currentNode.memoryId}/nodes/${params.nodeId}`);
  },
};
