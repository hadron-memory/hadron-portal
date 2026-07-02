import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, UPDATE_NODE_MUTATION, MOVE_NODE_MUTATION } from '$lib/server/queries';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
    NODE_BY_ID_QUERY, { id: params.nodeId },
  );
  if (!data.nodeById) throw new Error(`Node not found: ${params.nodeId}`);
  // #237: same URL-acceptance guard as the detail page. Without it, an
  // edit URL with a mismatched (gid, nodeId) would let the user save
  // changes into the foreign node while believing they edit the current
  // memory's row. Redirect to the correct edit URL so the destination
  // memory is consistent with the node's actual ownership.
  if (data.nodeById.memoryId !== params.id) {
    redirect(303, `/app/memories/${data.nodeById.memoryId}/nodes/${params.nodeId}/edit`);
  }
  return { node: data.nodeById };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();

    const client = gqlClient(locals.token);

    // Load current node to get its loc
    const { nodeById: currentNode } = await client.request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!currentNode) return fail(404, { error: 'Node not found' });

    const name = String(fd.get('name') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    const alias = String(fd.get('alias') ?? '').trim() || null;
    // Empty/whitespace-only → null so the server clears the abstract rather
    // than storing an empty string (it normalizes the same way, but being
    // explicit keeps the mutation payload honest). Cap is enforced server-side.
    const abstract = String(fd.get('abstract') ?? '').trim() || null;
    const content = String(fd.get('content') ?? '').trim() || null;
    const seqVal = fd.get('seq');
    const seqRaw = seqVal != null ? String(seqVal).trim() : '';
    const seqParsed = seqRaw !== '' ? parseInt(seqRaw, 10) : null;
    const seq = seqParsed !== null && Number.isNaN(seqParsed) ? null : seqParsed;
    const tagsStr = String(fd.get('tags') ?? '').trim();
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    // Checkbox: present (value "true") when checked, absent when unchecked.
    // This form rewrites the full field set, so send an explicit boolean
    // either way (updateNode preserves omitted fields — an absent checkbox
    // would otherwise never uncheck).
    const isRunnable = fd.get('isRunnable') === 'true';
    const rawLoc = String(fd.get('loc') ?? '').trim();
    const newLoc = cleanLocInput(rawLoc);

    // Parse edges from JSON
    let edges: { targetId: string; name: string }[] | undefined;
    const edgesJson = String(fd.get('edges') ?? '');
    if (edgesJson) {
      try { edges = JSON.parse(edgesJson); } catch { /* ignore */ }
    }

    if (!name) return fail(400, { error: 'Name is required' });

    // #237: route every mutation through the node's actual memoryId, not
    // the URL's gid. Form actions run BEFORE `load`, so the URL guard
    // above doesn't run on POST — a stale URL would otherwise commit
    // the user's edit into the wrong memory.
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    if (loc !== currentNode.loc) {
      try {
        await client.request(MOVE_NODE_MUTATION, {
          from: currentNode.loc,
          to: loc,
          memoryId: currentNode.memoryId,
        });
      } catch (e: unknown) {
        return fail(500, { error: e instanceof Error ? e.message : 'Failed to move node' });
      }
    }

    try {
      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          memoryId: currentNode.memoryId,
          loc,
          name,
          description,
          alias,
          abstract,
          content,
          seq,
          tags,
          isRunnable,
          edges,
        },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save' });
    }

    // Redirect to the actual memory's detail URL, not the URL's gid.
    redirect(303, `/app/memories/${currentNode.memoryId}/nodes/${params.nodeId}`);
  },
};
