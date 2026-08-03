import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';
import type { Memory } from '$lib/types';
import type { PageServerLoad } from './$types';

// Read-only public memory list. The "Use this memory" action that used to live
// here posted to `addToMyMemories`, retired server-side in hadron-server#771
// (spec 048) — it subscribed the caller's personal org, and personal orgs are
// gone. It had been failing at runtime ever since; #681 removed it along with
// the sign-up "add this memory" intent branch that fed it.
export const load: PageServerLoad = async () => {
  try {
    const memories = await fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories');
    return { memories };
  } catch {
    return { memories: [] as Memory[] };
  }
};
