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
    return { memories, loadFailed: false };
  } catch (e: unknown) {
    // #687 — degrade, but SAY SO. The catch stays (this is the portal's public
    // front door; a 500 here is worse than a degraded page), but it no longer
    // hands the component a shape indistinguishable from an empty catalogue.
    //
    // "No public memories yet" during an outage is the lie
    // hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch exists to prevent: a system error rendered
    // as a fact about the world. `loadFailed` is what lets the empty state mean
    // only what it says.
    console.error('[browse] public memories query failed; reporting it to the page', e);
    return { memories: [] as Memory[], loadFailed: true };
  }
};
