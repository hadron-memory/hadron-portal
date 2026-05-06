// 010-create-node-on-portal — create-node form route.
// Form is reached via the '+' affordance on TreeView rows in MemoryBrowser.
// Server-side authz: upsertNode's resolver enforces requireMemoryWriteAccess.
// The portal also guards via requireNonConsumer.

import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { GRAPH_NODES_QUERY, UPSERT_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import { performCreate } from '$lib/nodes/perform-create';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, params, parent }) => {
  await requireNonConsumer(parent);
  const layoutData = await parent();

  const parentLoc = (url.searchParams.get('parent') ?? '').trim();
  const memoryNodes = (layoutData.graphNodes ?? []) as MemoryNode[];
  const parentNode = parentLoc
    ? memoryNodes.find((n) => n.loc === parentLoc) ?? null
    : null;

  return {
    memoryId: params.gid,
    parentLoc,
    parentNode,
    parentMissing: parentLoc !== '' && !parentNode,
    writableSiblings: memoryNodes
      .filter((n) => n.memoryId === params.gid)
      .map((n) => ({ id: n.id, loc: n.loc, name: n.name }))
      .sort((a, b) => a.loc.localeCompare(b.loc)),
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const title = String(fd.get('title') ?? '');
    const type = String(fd.get('type') ?? '');
    const parentLoc = String(fd.get('parent') ?? '');

    const client = gqlClient(locals.token);

    // Refetch the memory's nodes so loc-collision resolution sees the
    // latest siblings — load() data isn't available to actions.
    const { nodes } = await client.request<{ nodes: MemoryNode[] }>(
      GRAPH_NODES_QUERY, { limit: 5000 },
    );
    const existingLocs = new Set(
      nodes.filter((n) => n.memoryId === params.gid).map((n) => n.loc),
    );

    const result = await performCreate(
      { memoryId: params.gid, parentLoc, title, type },
      {
        existingLocs,
        upsertNode: async (input) => {
          const data = await client.request<{ upsertNode: { id: string; loc: string } }>(
            UPSERT_NODE_MUTATION, { input },
          );
          return data.upsertNode;
        },
      },
    );

    if (!result.ok) {
      const status =
        result.error === 'permissionDenied' ? 403
        : result.error === 'network' ? 503
        : result.error === 'locCollisionExhausted' ? 409
        : 400;
      return fail(status, {
        error: result.error,
        fields: { title, type, parent: parentLoc },
      });
    }

    redirect(
      303,
      `/app/orgs/${params.id}/memories/${params.gid}/nodes/${result.createdNodeId}`,
    );
  },
};
