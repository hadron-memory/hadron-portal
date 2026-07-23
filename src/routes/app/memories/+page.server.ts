// #627: /app/memories is the individual user's org-less "My memories" surface.
// Org members keep the spec-014 behavior — a 302 to their active org's memories
// grid — while consumer / org-less users get a real list of the memories they
// own (organizationId == null), so they're no longer bounced into the phantom
// personal org (#628).
import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { PERSONAL_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { activeOrgId, isConsumerMode } = await parent();

  // Org members: preserve the redirector (their memories live under the org).
  if (!isConsumerMode && activeOrgId) {
    redirect(302, `/app/orgs/${activeOrgId}/memories`);
  }

  // Consumer / org-less: list the user's own (org-less) memories. The server
  // returns the caller's accessible personal/private memories; keep only the
  // ones with no owning org — those are the ones this user owns directly.
  // Distinguish a FAILED fetch from a genuinely empty list (`loadFailed`) — this
  // is a primary consumer surface, and silently rendering the empty state on an
  // API error would hide existing memories and invite duplicate creation
  // (review; conventions:no-silent-loader-catch).
  try {
    const memories = await fetchAllItems<Memory>(gqlClient(locals.token), PERSONAL_MEMORIES_QUERY, 'memories');
    return { memories: memories.filter((m) => m.organizationId == null), loadFailed: false };
  } catch (e) {
    console.error('[my-memories] failed to load personal memories:', e);
    return { memories: [] as Memory[], loadFailed: true };
  }
};
