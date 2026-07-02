import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_QUERY, UPDATE_NODE_MUTATION } from '$lib/server/queries';
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
      // #335: scope the read to the target memory — node(loc:) is otherwise
      // memory-blind and now errors on a cross-memory loc collision.
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { loc: u.loc, memory: memoryId });
      if (!node) continue;
      // #235: explicit tags pass-through. updateNode preserves omitted
      // tags (unlike the old upsertNode resolver's `input.tags ?? []`
      // default), so this is no longer load-bearing — kept deliberately;
      // see routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts
      // updateContent for the rationale.
      await client.request(UPDATE_NODE_MUTATION, {
        input: { memoryId, loc: u.loc, tags: node.tags ?? [], seq: u.seq },
      });
    }
    return json({ ok: true });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : 'Failed to reorder' }, { status: 500 });
  }
};
