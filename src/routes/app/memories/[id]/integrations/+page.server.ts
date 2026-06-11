import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { extractGqlError } from '$lib/server/gqlError';
import {
  UPDATE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUSH_MEMORY_TO_GIT_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

// This is a mutating edit surface (update/sync/push), so — like /settings —
// keep consumer-mode users out of it.
export const load: PageServerLoad = async ({ parent }) => {
  await requireNonConsumer(parent);
};

// #266: the GitHub integration (source + branches) and sync/push actions split
// out of the Settings page into their own tab. This `update` touches ONLY the
// integration fields so it can't clobber memory metadata (and the Settings
// `update` no longer touches these fields).
export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.id,
        source: String(fd.get('source') ?? '').trim() || null,
        readBranch: String(fd.get('readBranch') ?? '').trim() || null,
        writeBranch: String(fd.get('writeBranch') ?? '').trim() || null,
      });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update integration') });
    }
  },

  sync: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: params.id });
      return { synced: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Sync failed') });
    }
  },

  pushToGit: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(PUSH_MEMORY_TO_GIT_MUTATION, { id: params.id });
      return { pushed: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Push to Git failed') });
    }
  },
};
