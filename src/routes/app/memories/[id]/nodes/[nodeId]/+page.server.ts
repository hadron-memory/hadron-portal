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

  // #237: the URL-acceptance counterpart to #234's URL-emission fix. The
  // route is scoped by `[id]` (the memory id) but `nodeById` resolves by PK alone, so a
  // mismatched URL (stale tab after a node move, manual edit, future link
  // bug, etc.) would silently render a foreign node under the current
  // memory's basePath. Redirect to the correct memory's URL so the user
  // lands on the right page — matches the R-9 inaccessible-deep-link
  // pattern in +layout.server.ts. If the user can't access node.memoryId,
  // the redirected memory layout will throw "Memory not found" — a clean
  // failure mode rather than the silent wrong-node render.
  if (node.memoryId !== params.id) {
    redirect(303, `/app/memories/${node.memoryId}/nodes/${params.nodeId}`);
  }

  // Build breadcrumb from loc segments — look up ancestor nodes within THIS
  // memory only. Resolving by loc alone (via NODE_QUERY) would cross-pollinate
  // with any other memory the caller can access that happens to share the loc,
  // producing breadcrumb links like memories/A/nodes/<B's PK>. See #234.
  const memoryNodes = parentData.graphNodes ?? [];
  const ancestorIdByLoc = new Map<string, string>();
  for (const n of memoryNodes) {
    if (n.memoryId === params.id) ancestorIdByLoc.set(n.loc, n.id);
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
  // #237 review follow-up: every mutating action below derives `memoryId`
  // from the node fetched by PK rather than from `params.gid`. The load
  // guard above only protects GETs — form actions run BEFORE `load`, so
  // a POST to a stale-URL (different memory in the URL than where the
  // node actually lives) would otherwise mutate / delete / move against
  // the wrong memory. Deriving memoryId from the fetched node preserves
  // the user's input (their submission goes to the correct destination)
  // and the post-action navigation re-runs `load`, whose redirect then
  // fixes the URL on screen.
  createParent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const loc = String(fd.get('loc') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    if (!loc || !name) return fail(400, { error: 'Missing loc or name' });
    const client = gqlClient(locals.token);
    // #237: derive memoryId from the anchor (URL) node so a stale URL
    // doesn't write the new parent into the wrong memory.
    const { nodeById: anchorNode } = await client.request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!anchorNode) return fail(404, { error: 'Node not found' });
    try {
      const res = await client.request<{ upsertNode: { id: string } }>(UPSERT_NODE_MUTATION, {
        input: { memoryId: anchorNode.memoryId, loc, name, nodeType: 'info' },
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

    // Move if loc changed. #237: route both mutations through the node's
    // actual memoryId, not the URL's.
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    if (loc !== currentNode.loc) {
      try {
        await client.request(MOVE_NODE_MUTATION, { from: currentNode.loc, to: loc, memoryId: currentNode.memoryId });
      } catch (e: unknown) {
        return fail(500, { error: e instanceof Error ? e.message : 'Failed to move node' });
      }
    }

    try {
      await client.request(UPSERT_NODE_MUTATION, {
        input: { memoryId: currentNode.memoryId, loc, name, description, alias, seq: Number.isNaN(seq) ? null : seq, tags },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save' });
    }
  },

  delete: async ({ params, locals }) => {
    // Load the node to get its loc AND its actual memoryId (#237).
    const data = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!data.nodeById) return fail(404, { error: 'Node not found' });
    const node = data.nodeById;
    try {
      await gqlClient(locals.token).request(DELETE_NODE_MUTATION, { loc: node.loc, memoryId: node.memoryId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete' });
    }
    // Redirect to the *actual* memory's list — not the URL's gid, which
    // may have been stale.
    redirect(303, `/app/memories/${node.memoryId}/nodes`);
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
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          name: node.name,
          // #235: tags must be passed through explicitly. The upsertNode
          // resolver defaults `input.tags ?? []`, so omitting tags clears
          // them on save. Other "missing" fields (description, alias,
          // seq, data) are safe because Prisma treats undefined as
          // "don't update" — but tags has an explicit empty-array
          // default that bypasses that semantic. The `?? []` guards
          // against the runtime case where node.tags arrives as null
          // (e.g. via a future schema-shape regression): explicit []
          // matches what the user already has, so it round-trips safely.
          tags: node.tags ?? [],
          content,
        },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  updateAbstract: async ({ request, params, locals }) => {
    const fd = await request.formData();
    // Send the raw string; the server normalizes empty/whitespace-only to
    // null (spec 031) and recomputes abstractOriginHash from current
    // content (spec 032). Length cap (2000) is enforced server-side too,
    // with a client-side maxlength as the first line of defense.
    const abstract = String(fd.get('abstract') ?? '');

    const client = gqlClient(locals.token);
    try {
      const { nodeById: node } = await client.request<{ nodeById: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPSERT_NODE_MUTATION, {
        input: {
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          name: node.name,
          // #235: tags must be passed through explicitly or the upsertNode
          // resolver's `input.tags ?? []` default clears them. See
          // updateContent for the full rationale.
          tags: node.tags ?? [],
          abstract,
        },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  // Node.data is a free-form JSON object/value surfaced on the Data tab.
  // The client posts the raw editor text; we parse it here so a malformed
  // body fails fast with a readable message instead of an opaque
  // GraphQL/Prisma error. The upsertNode resolver feeds `data` straight
  // into a Prisma `Json?` column, which rejects a bare JS `null` (it wants
  // Prisma.DbNull / JsonNull) — so clearing the field isn't supported here:
  // both an empty body and a top-level JSON `null` are rejected, and we
  // never send `null` downstream. The client gates Save on the same rules;
  // these are the server-side backstop.
  updateData: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const raw = String(fd.get('data') ?? '').trim();
    if (raw === '') return fail(400, { error: 'No JSON provided' });

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON' });
    }
    if (data === null) return fail(400, { error: 'Top-level JSON null is not allowed' });

    const client = gqlClient(locals.token);
    try {
      const { nodeById: node } = await client.request<{ nodeById: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPSERT_NODE_MUTATION, {
        input: {
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          name: node.name,
          // #235: tags must be passed through explicitly or the upsertNode
          // resolver's `input.tags ?? []` default clears them. See
          // updateContent for the full rationale.
          tags: node.tags ?? [],
          data,
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
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          name: node.name,
          // #235: preserve tags — see updateContent for the rationale
          // (including why we coalesce a null `node.tags` to []).
          tags: node.tags ?? [],
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
    // #237: derive memoryId from the URL's anchor node so a stale-URL
    // POST reorders within the actual memory, not the URL's gid.
    const { nodeById: anchorNode } = await client.request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!anchorNode) return fail(404, { error: 'Anchor node not found' });
    try {
      for (const u of updates) {
        // NODE_QUERY(loc:) is still memory-blind here (#234 left this
        // call site as a noted follow-up). Worst case on collision: the
        // siblings being reordered are within `anchorNode.memoryId`'s
        // tree (the user is drag-reordering that tree), so `name` comes
        // from the right place in practice. If a foreign memory shares
        // the same loc and wins the resolver's first-match, the upsert
        // below still targets anchorNode.memoryId, so the wrong-name
        // value goes into the right memory's row — visible-but-fixable.
        const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { loc: u.loc });
        if (!node) continue;
        await client.request(UPSERT_NODE_MUTATION, {
          input: {
            memoryId: anchorNode.memoryId,
            loc: u.loc,
            name: node.name,
            // #235: preserve tags — see updateContent for the rationale
            // (including why we coalesce a null `node.tags` to []).
            tags: node.tags ?? [],
            seq: u.seq,
          },
        });
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Reorder failed' });
    }
  },
};
