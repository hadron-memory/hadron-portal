import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_QUERY, UPSERT_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { updates, memoryId } = await request.json();
  if (!Array.isArray(updates) || !memoryId) {
    return json({ error: 'updates array and memoryId are required' }, { status: 400 });
  }

  const client = gqlClient(locals.token);
  try {
    for (const u of updates) {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { loc: u.loc });
      if (!node) continue;
      // #235: tags must be passed through. The upsertNode resolver
      // defaults `input.tags ?? []`, so omitting tags clears them. See
      // routes/app/orgs/[id]/memories/[gid]/nodes/[nodeId]/+page.server.ts
      // updateContent for the long-form rationale.
      await client.request(UPSERT_NODE_MUTATION, {
        input: { memoryId, loc: u.loc, name: node.name, tags: node.tags, seq: u.seq },
      });
    }
    return json({ ok: true });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : 'Failed to reorder' }, { status: 500 });
  }
};
