import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { NODE_QUERY } from '$lib/server/queries';
import { nodeUpdateDocument } from '$lib/server/nodeKindDoor';
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
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { ref: u.loc, memoryRef: memoryId });
      if (!node) continue;
      // #235: explicit tags pass-through. updateNode preserves omitted
      // tags (unlike the old upsertNode resolver's `input.tags ?? []`
      // default), so this is no longer load-bearing — kept deliberately;
      // see routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts
      // updateContent for the rationale.
      // #868: the door is chosen per node from the node being written. This
      // endpoint is the tree view's drag-to-reorder, so a memory holding ONE
      // task node made every reorder that touched it fail.
      const input = { memoryId, loc: u.loc, tags: node.tags ?? [], seq: u.seq };
      await client.request(nodeUpdateDocument(node, input), { input });
    }
    return json({ ok: true });
  } catch (e: unknown) {
    return json({ error: extractGqlError(e, 'Failed to reorder') }, { status: 500 });
  }
};
