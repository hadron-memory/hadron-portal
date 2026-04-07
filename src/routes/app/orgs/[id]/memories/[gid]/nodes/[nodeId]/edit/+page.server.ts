import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, UPSERT_NODE_MUTATION, MOVE_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
    NODE_BY_ID_QUERY, { id: params.nodeId },
  );
  if (!data.nodeById) throw new Error(`Node not found: ${params.nodeId}`);
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
    const content = String(fd.get('content') ?? '').trim() || null;
    const seqVal = fd.get('seq');
    const seqRaw = seqVal != null ? String(seqVal).trim() : '';
    const seqParsed = seqRaw !== '' ? parseInt(seqRaw, 10) : null;
    const seq = seqParsed !== null && Number.isNaN(seqParsed) ? null : seqParsed;
    const tagsStr = String(fd.get('tags') ?? '').trim();
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const newLoc = String(fd.get('loc') ?? '').trim();

    // Parse edges from JSON
    let edges: { targetId: string; label: string }[] | undefined;
    const edgesJson = String(fd.get('edges') ?? '');
    if (edgesJson) {
      try { edges = JSON.parse(edgesJson); } catch { /* ignore */ }
    }

    if (!name) return fail(400, { error: 'Name is required' });

    // If loc changed, move the node first
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    if (loc !== currentNode.loc) {
      try {
        await client.request(MOVE_NODE_MUTATION, {
          from: currentNode.loc,
          to: loc,
          memoryId: params.gid,
        });
      } catch (e: unknown) {
        return fail(500, { error: e instanceof Error ? e.message : 'Failed to move node' });
      }
    }

    try {
      await client.request(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.gid,
          loc,
          name,
          description,
          alias,
          content,
          seq,
          tags,
          edges,
        },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save' });
    }

    redirect(303, `/app/orgs/${params.id}/memories/${params.gid}/nodes/${params.nodeId}`);
  },
};
