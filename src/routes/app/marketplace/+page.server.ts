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
    };
  } catch (e: unknown) {
    // Log before degrading — an outage otherwise renders as "The marketplace is
    // empty for now." with no trace. Surfacing it to the user is tracked in #687.
    console.error('[marketplace] catalogue query failed; rendering empty sections', e);
    return { organizations: EMPTY, agents: EMPTY, memories: EMPTY };
  }
};

// The `addToMyMemories` action that used to live here (and its "Use this
// memory" button) was removed in #681: hadron-server#771 retired the mutation
// with spec 048's personal orgs, so it had been throwing at runtime. The
// catalogue stays browsable; there is no server-side capability to re-point it
// at yet.
