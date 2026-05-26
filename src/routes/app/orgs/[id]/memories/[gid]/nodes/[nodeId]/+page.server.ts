import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, NODE_QUERY, DELETE_NODE_MUTATION, UPSERT_NODE_MUTATION, MOVE_NODE_MUTATION } from '$lib/server/queries';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  // parent() and nodeById are independent — fetch in parallel.
  // SvelteKit memoizes parent() across the load, so the guard's later call
  // does not refetch; passing a thunk that resolves to the already-fetched
  // value keeps the guard signature reusable without an extra round-trip.
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);
  if (!data.nodeById) throw new Error(`Node not found: ${params.nodeId}`);
  const node = data.nodeById;

  // Build breadcrumb from loc segments — look up ancestor nodes within THIS
  // memory only. Resolving by loc alone (via NODE_QUERY) would cross-pollinate
  // with any other memory the caller can access that happens to share the loc,
  // producing breadcrumb links like memories/A/nodes/<B's PK>. See #234.
  const memoryNodes = parentData.graphNodes ?? [];
  const ancestorIdByLoc = new Map<string, string>();
  for (const n of memoryNodes) {
    if (n.memoryId === params.gid) ancestorIdByLoc.set(n.loc, n.id);
  }

  const parts = node.loc.split(':');
  const breadcrumb: Array<{ label: string; path: string; nodeId: string | null }> = [];

  for (let i = 0; i < parts.length; i++) {
    const ancestorLoc = parts.slice(0, i + 1).join(':');
    let nodeId: string | null = null;
    if (i < parts.length - 1) {
      nodeId = ancestorIdByLoc.get(ancestorLoc) ?? null;
    }
    breadcrumb.push({ label: parts[i], path: ancestorLoc, nodeId });
  }

  return { node, breadcrumb };
};

export const actions: Actions = {
  createParent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const loc = String(fd.get('loc') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    if (!loc || !name) return fail(400, { error: 'Missing loc or name' });
    try {
      const res = await gqlClient(locals.token).request<{ upsertNode: { id: string } }>(UPSERT_NODE_MUTATION, {
        input: { memoryId: params.gid, loc, name, nodeType: 'info' },
      });
      return { createdParentId: res.upsertNode.id };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create parent node' });
    }
  },

  updateMeta: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);

    const { nodeById: currentNode } = await client.request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!currentNode) return fail(404, { error: 'Node not found' });

    const name = String(fd.get('name') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    const alias = String(fd.get('alias') ?? '').trim() || null;
    const seqRaw = String(fd.get('seq') ?? '').trim();
    const seq = seqRaw !== '' ? parseInt(seqRaw, 10) : null;
    const tagsStr = String(fd.get('tags') ?? '').trim();
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const newLoc = cleanLocInput(String(fd.get('loc') ?? ''));

    if (!name) return fail(400, { error: 'Name is required' });

    // Move if loc changed
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    if (loc !== currentNode.loc) {
      try {
        await client.request(MOVE_NODE_MUTATION, { from: currentNode.loc, to: loc, memoryId: params.gid });
      } catch (e: unknown) {
        return fail(500, { error: e instanceof Error ? e.message : 'Failed to move node' });
      }
    }

    try {
      await client.request(UPSERT_NODE_MUTATION, {
        input: { memoryId: params.gid, loc, name, description, alias, seq: Number.isNaN(seq) ? null : seq, tags },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save' });
    }
  },

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

  updateEdges: async ({ request, params, locals }) => {
    // Replaces the full set of outgoing edges on this node. The client sends
    // a JSON-encoded array of { targetId, label } — we pass it through the
    // upsertNode mutation, which replaces all outgoing edges atomically.
    const fd = await request.formData();
    const edgesJson = String(fd.get('edges') ?? '[]');
    let edges: Array<{ targetId: string; label?: string }>;
    try {
      edges = JSON.parse(edgesJson);
    } catch {
      return fail(400, { error: 'Invalid edges JSON' });
    }
    if (!Array.isArray(edges)) return fail(400, { error: 'Edges must be an array' });

    const client = gqlClient(locals.token);
    try {
      const { nodeById: node } = await client.request<{ nodeById: MemoryNode | null }>(
        NODE_BY_ID_QUERY, { id: params.nodeId },
      );
      if (!node) return fail(404, { error: 'Node not found' });
      await client.request(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.gid,
          loc: node.loc,
          name: node.name,
          edges: edges.map((e) => ({
            targetId: e.targetId,
            label: e.label ?? null,
          })),
        },
      });
      return { edgesUpdated: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update edges' });
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
