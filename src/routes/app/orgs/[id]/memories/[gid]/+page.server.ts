import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  UPDATE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  await requireNonConsumer(parent);
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const tagsRaw = String(fd.get('tags') ?? '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.gid,
        shortDescription: String(fd.get('shortDescription') ?? '').trim() || null,
        description: String(fd.get('description') ?? '').trim() || null,
        tags,
        license: String(fd.get('license') ?? '').trim() || null,
        category0: String(fd.get('category0') ?? '').trim() || null,
        category1: String(fd.get('category1') ?? '').trim() || null,
        category2: String(fd.get('category2') ?? '').trim() || null,
        iconUrl: String(fd.get('iconUrl') ?? '').trim() || null,
        heroUrl: String(fd.get('heroUrl') ?? '').trim() || null,
        homeUrl: String(fd.get('homeUrl') ?? '').trim() || null,
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
      await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: params.gid });
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
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.gid, orgId, role });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add subscription' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.gid, orgId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to remove subscription' });
    }
  },
};
