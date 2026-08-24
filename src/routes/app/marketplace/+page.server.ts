import { gqlClient } from '$lib/server/api';
import { MARKETPLACE_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/** A sanitized marketplace ref (cor:acl:080:02/04). */
export interface MarketplaceRef {
  id: string;
  name: string;
  urn: string;
  description: string | null;
}
interface MarketplaceSection {
  items: MarketplaceRef[];
  total: number;
}
const EMPTY: MarketplaceSection = { items: [], total: 0 };

// cor:acl:080:04 — browse the marketplace catalogue (listedOnMarketplace +
// publicly accessible orgs / agents / memories). Public; a token is forwarded
// when present but the server queries require no membership. Loads the first
// page of each section.
export const load: PageServerLoad = async ({ locals }) => {
  try {
    const data = await gqlClient(locals.token).request<{
      marketplaceOrganizations: MarketplaceSection;
      marketplaceAgents: MarketplaceSection;
      marketplaceMemories: MarketplaceSection;
    }>(MARKETPLACE_QUERY, { limit: 60 });
    return {
      organizations: data.marketplaceOrganizations,
      agents: data.marketplaceAgents,
      memories: data.marketplaceMemories,
      loadFailed: false,
    };
  } catch (e: unknown) {
    // #687 — degrade, but SAY SO. See the sibling comment in
    // src/routes/browse/+page.server.ts: the catch stays, but the page is told
    // the difference between "the catalogue is empty" and "we could not read
    // it", instead of both arriving as EMPTY sections.
    //
    // One query backs all three sections, so one flag is the honest shape —
    // a per-section flag would imply the sections can fail independently.
    console.error('[marketplace] catalogue query failed; reporting it to the page', e);
    return { organizations: EMPTY, agents: EMPTY, memories: EMPTY, loadFailed: true };
  }
};

// The `addToMyMemories` action that used to live here (and its "Use this
// memory" button) was removed in #681: hadron-server#771 retired the mutation
// with spec 048's personal orgs, so it had been throwing at runtime. The
// catalogue stays browsable; there is no server-side capability to re-point it
// at yet.
