// /app/memories is "My memories" — the caller's OWN (org-less, user-owned)
// memories — for EVERYONE. It no longer redirects org members to their org grid:
// an org member is also a person who can own personal/private memories, and
// those had no route (the old 302 stranded them). Org memories stay under
// /app/orgs/[id]/memories, reached via the org "Memories" nav item.
import { fetchOwnedMemories } from '$lib/server/personal-memories';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // List the user's own (org-less) memories. Distinguish a FAILED fetch from a
  // genuinely empty list (`loadFailed`) — silently rendering the empty state on
  // an API error would hide existing memories and invite duplicate creation
  // (conventions:no-silent-loader-catch).
  try {
    return { memories: await fetchOwnedMemories(locals.token), loadFailed: false };
  } catch (e) {
    console.error('[my-memories] failed to load personal memories:', e);
    return { memories: [] as Memory[], loadFailed: true };
  }
};
