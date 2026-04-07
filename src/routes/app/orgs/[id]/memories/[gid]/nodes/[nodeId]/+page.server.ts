import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, NODE_QUERY, DELETE_NODE_MUTATION, UPSERT_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
    NODE_BY_ID_QUERY, { id: params.nodeId },
  );
  if (!data.nodeById) throw new Error(`Node not found: ${params.nodeId}`);
  const node = data.nodeById;

  // Build breadcrumb from loc segments (colon-delimited)
  const parts = node.loc.split(':');
  const breadcrumb = parts.map((part, i) => ({
    label: part,
    path: parts.slice(0, i + 1).join(':'),
  }));

  return { node, breadcrumb };
};

export const actions: Actions = {
  delete: async ({ params, locals }) => {
    // Load the node to get its loc
    const data = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!data.nodeById) return fail(404, { error: 'Node not found' });
    try {
      await gqlClient(locals.token).request(DELETE_NODE_MUTATION, { loc: data.nodeById.loc, memoryId: params.gid });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete' });
    }
    redirect(303, `/app/orgs/${params.id}/memories/${params.gid}/nodes`);
  },

  updateContent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const content = String(fd.get('content') ?? '');

    const client = gqlClient(locals.token);
    try {
      const { nodeById: node } = await client.request<{ nodeById: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.gid,
          loc: node.loc,
          name: node.name,
          content,
        },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  reorder: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const updatesJson = String(fd.get('updates') ?? '');
    let updates: { loc: string; seq: number }[];
    try {
      updates = JSON.parse(updatesJson);
    } catch {
      return fail(400, { error: 'Invalid updates' });
    }

    const client = gqlClient(locals.token);
    try {
      for (const u of updates) {
        const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { loc: u.loc });
        if (!node) continue;
        await client.request(UPSERT_NODE_MUTATION, {
          input: {
            memoryId: params.gid,
            loc: u.loc,
            name: node.name,
            seq: u.seq,
          },
        });
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Reorder failed' });
    }
  },
};
