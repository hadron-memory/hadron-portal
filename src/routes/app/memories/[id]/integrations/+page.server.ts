import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  UPDATE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUSH_MEMORY_TO_GIT_MUTATION,
} from '$lib/server/queries';
import type { Actions } from './$types';

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
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update integration' });
    }
  },

  sync: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: params.id });
      return { synced: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Sync failed' });
    }
  },

  pushToGit: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(PUSH_MEMORY_TO_GIT_MUTATION, { id: params.id });
      return { pushed: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Push to Git failed' });
    }
  },
};
