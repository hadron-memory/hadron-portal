// /app/memories has two tabs: "My memories" — the caller's OWN (org-less,
// user-owned) memories, for EVERYONE (an org member is also a person who can own
// personal/private memories; the old 302 to the org grid stranded them) — and
// "Memories shared with me" — memories other users shared with the caller via
// MemoryShare (#778). Org memories stay under /app/orgs/[id]/memories.
import { fail } from '@sveltejs/kit';
import { fetchOwnedMemories, fetchSharedMemories } from '$lib/server/personal-memories';
import type { SharedMemory } from '$lib/server/personal-memories';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { DELETE_MEMORY_SHARE_MUTATION } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
  // #649: the grantee removes their OWN share of a memory ("Leave"). Calls
  // deleteMemoryShare with NO granteeRef → the server targets the caller's own
  // grantee row (principal-or-self auth; a grantee can only ever affect their
  // own share). On success the shared list re-loads without the row.
  leaveShare: async ({ request, locals }) => {
    const data = await request.formData();
    const memoryId = String(data.get('memoryId') ?? '').trim();
    if (!memoryId) return fail(400, { leaveError: 'Missing memory.' });

    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SHARE_MUTATION, { memoryRef: memoryId });
    } catch (e) {
      return fail(500, {
        leaveError: extractGqlError(e, 'Failed to remove the shared memory. Please try again.'),
      });
    }
    return { leaveSuccess: true };
  },
};
