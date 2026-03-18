import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, DELETE_MEMORY_MUTATION, SYNC_MEMORY_MUTATION } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
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
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete memory' });
    }
  },

  syncAll: async ({ params, locals }) => {
    const data = await gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    );
    const memories = data.organization.memories ?? [];
    const errors: string[] = [];
    for (const m of memories) {
      if (!m.source) continue;
      try {
        await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: m.id });
      } catch (e: unknown) {
        errors.push(`${m.name}: ${e instanceof Error ? e.message : 'sync failed'}`);
      }
    }
    if (errors.length) {
      return fail(500, { error: `Sync errors: ${errors.join('; ')}` });
    }
    return { synced: true };
  },
};
