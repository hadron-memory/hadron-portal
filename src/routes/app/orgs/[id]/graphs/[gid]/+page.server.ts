import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  UPDATE_GRAPH_MUTATION,
  SYNC_GRAPH_MUTATION,
  CREATE_GRAPH_SUBSCRIPTION_MUTATION,
  DELETE_GRAPH_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Actions } from './$types';

// Data is provided by the parent +layout.server.ts (org, graph, graphNodes, etc.)

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    try {
      await gqlClient(locals.token).request(UPDATE_GRAPH_MUTATION, {
        id: params.gid,
        source: String(fd.get('source') ?? '').trim() || null,
        readBranch: String(fd.get('readBranch') ?? '').trim() || null,
        writeBranch: String(fd.get('writeBranch') ?? '').trim() || null,
        visibility: String(fd.get('visibility') ?? 'PRIVATE'),
      });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update' });
    }
  },

  sync: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(SYNC_GRAPH_MUTATION, { id: params.gid });
      return { synced: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Sync failed' });
    }
  },

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '');
    const role = String(fd.get('role') ?? 'READER');
    try {
      await gqlClient(locals.token).request(CREATE_GRAPH_SUBSCRIPTION_MUTATION, { graphId: params.gid, orgId, role });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add subscription' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_GRAPH_SUBSCRIPTION_MUTATION, { graphId: params.gid, orgId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to remove subscription' });
    }
  },
};
