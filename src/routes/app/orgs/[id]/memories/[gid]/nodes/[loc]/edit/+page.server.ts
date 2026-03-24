import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_QUERY, UPSERT_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const loc = decodeURIComponent(params.loc);
  const data = await gqlClient(locals.token).request<{ node: MemoryNode | null }>(
    NODE_QUERY, { loc },
  );
  if (!data.node) throw new Error(`Node not found: ${loc}`);
  return { node: data.node };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const loc = decodeURIComponent(params.loc);

    const name = String(fd.get('name') ?? '').trim();
    const title = String(fd.get('title') ?? '').trim() || name;
    const description = String(fd.get('description') ?? '').trim() || null;
    const alias = String(fd.get('alias') ?? '').trim() || null;
    const content = String(fd.get('content') ?? '').trim() || null;
    const seqRaw = String(fd.get('seq') ?? '').trim();
    const seq = seqRaw !== '' ? parseInt(seqRaw, 10) : null;
    const tagsStr = String(fd.get('tags') ?? '').trim();
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];

    // Parse edges from JSON
    let edges: { targetId: string; label: string }[] | undefined;
    const edgesJson = String(fd.get('edges') ?? '');
    if (edgesJson) {
      try { edges = JSON.parse(edgesJson); } catch { /* ignore */ }
    }

    if (!name) return fail(400, { error: 'Name is required' });

    try {
      await gqlClient(locals.token).request(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.gid,
          loc,
          name,
          title,
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

    redirect(303, `/app/orgs/${params.id}/memories/${params.gid}/nodes/${encodeURIComponent(loc)}`);
  },
};
