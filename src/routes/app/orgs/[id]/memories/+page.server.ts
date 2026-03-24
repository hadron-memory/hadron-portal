import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  DELETE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUBLIC_MEMORIES_QUERY,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const [orgData, publicData] = await Promise.all([
    gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    ),
    gqlClient().request<{ publicMemories: Memory[] }>(PUBLIC_MEMORIES_QUERY).catch(() => ({
      publicMemories: [] as Memory[],
    })),
  ]);
  // Exclude memories already owned or subscribed to by this org
  const ownedIds = new Set((orgData.organization.memories ?? []).map((m) => m.id));
  const subscribedIds = new Set((orgData.organization.subscriptions ?? []).map((s) => s.memory.id));
  const availableMemories = publicData.publicMemories.filter(
    (m) => !ownedIds.has(m.id) && !subscribedIds.has(m.id) && m.organizationId !== params.id,
  );
  return { org: orgData.organization, availableMemories };
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

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    const role = String(fd.get('role') ?? 'READER');
    if (!memoryId) return fail(400, { error: 'Memory ID is required' });
    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId,
        orgId: params.id,
        role,
      });
      return { subscribed: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to subscribe' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId,
        orgId: params.id,
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to unsubscribe' });
    }
  },
};
