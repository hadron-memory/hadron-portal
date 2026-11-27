import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { NODE_QUERY } from '$lib/server/queries';
import { assertNodeUpdateDoor, nodeUpdateDocument } from '$lib/server/nodeKindDoor';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';
import { limitBody, limitRefusal } from '$lib/server/limit-refusal';

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
    // #868: TWO PASSES, and the split is the point (@copilot on PR #869).
    //
    // The door is chosen per node from the node being written — this endpoint
    // is the tree view's drag-to-reorder, so a memory holding ONE task node
    // made every reorder that touched it fail. But the chooser can also REFUSE
    // (a node matching two governed kinds has no door), and refusing on the
    // fifth sibling after four have already been written leaves the tree in an
    // order the user never asked for, under a 500 that says nothing about it.
    //
    // So: resolve every node and every door FIRST, write only once they all
    // have one. This does not make the batch atomic — a refusal from the
    // SERVER mid-loop still half-applies, and that wants a batch mutation
    // rather than a reordering here — but it removes the half-apply this PR
    // would otherwise have added.
    const planned: { node: MemoryNode; input: Record<string, unknown> }[] = [];
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
      const input = { memoryRef: memoryId, loc: u.loc, tags: node.tags ?? [], seq: u.seq };
      assertNodeUpdateDoor(node, input);
      planned.push({ node, input });
    }
    for (const { node, input } of planned) {
      // The chooser is called INLINE here, not hoisted into `planned`, and the
      // preflight above is `assertNodeUpdateDoor` for the same reason: passing a
      // local to `.request()` makes the call opaque to check-graphql-callers,
      // which silently stops cross-checking its variables. Measured twice on
      // this PR — the checked call-site count drops by one per hoisted site.
      await client.request(nodeUpdateDocument(node, input), { input });
    }
    return json({ ok: true });
  } catch (e: unknown) {
    const limit = limitRefusal(e);
    if (limit) return json(limitBody(limit), { status: limit.status });
    return json({ error: extractGqlError(e, 'Failed to reorder') }, { status: 500 });
  }
};
