// /app/memories has two tabs: "My memories" — the caller's OWN (org-less,
// user-owned) memories, for EVERYONE (an org member is also a person who can own
// personal/private memories; the old 302 to the org grid stranded them) — and
// "Memories shared with me" — memories other users shared with the caller via
// MemoryShare (#778). Org memories stay under /app/orgs/[id]/memories.
import { fetchOwnedMemories, fetchSharedMemories } from '$lib/server/personal-memories';
import type { SharedMemory } from '$lib/server/personal-memories';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // Fetch both tabs independently — one tab's failure must not blank the other,
  // and a FAILED fetch is distinct from a genuinely empty list (silently showing
  // the empty state on an API error hides existing memories;
  // conventions:no-silent-loader-catch).
  const [owned, shared] = await Promise.allSettled([
    fetchOwnedMemories(locals.token),
    fetchSharedMemories(locals.token),
  ]);

  if (owned.status === 'rejected') {
    console.error('[my-memories] failed to load personal memories:', owned.reason);
  }
  if (shared.status === 'rejected') {
    console.error('[my-memories] failed to load shared memories:', shared.reason);
  }

  return {
    memories: owned.status === 'fulfilled' ? owned.value : ([] as Memory[]),
    loadFailed: owned.status === 'rejected',
    sharedMemories: shared.status === 'fulfilled' ? shared.value : ([] as SharedMemory[]),
    sharedLoadFailed: shared.status === 'rejected',
  };
};
