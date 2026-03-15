import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, DELETE_GRAPH_MUTATION, SYNC_GRAPH_MUTATION } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const data = await gqlClient(locals.token).request<{ organization: Organization }>(
    ORGANIZATION_QUERY, { id: params.id },
  );
  return { org: data.organization };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_GRAPH_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete graph' });
    }
  },

  syncAll: async ({ params, locals }) => {
    const data = await gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    );
    const graphs = data.organization.graphs ?? [];
    const errors: string[] = [];
    for (const g of graphs) {
      if (!g.source) continue;
      try {
        await gqlClient(locals.token).request(SYNC_GRAPH_MUTATION, { id: g.id });
      } catch (e: unknown) {
        errors.push(`${g.name}: ${e instanceof Error ? e.message : 'sync failed'}`);
      }
    }
    if (errors.length) {
      return fail(500, { error: `Sync errors: ${errors.join('; ')}` });
    }
    return { synced: true };
  },
};
