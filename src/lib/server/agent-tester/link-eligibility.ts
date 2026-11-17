import type { GraphQLClient } from 'graphql-request';
import { fetchAllItems } from '$lib/server/paginate';

// Same owner-only filter as the Tester's lookup, but this affordance needs
// only IDs. No platform-admin bypass and no owner identity exposed to the page.
export const TESTER_OWNED_AGENT_IDS_QUERY = /* GraphQL */ `
  query TesterOwnedAgentIds($limit: Int, $offset: Int) {
    agents(filter: { ownedByMe: true }, limit: $limit, offset: $offset) {
      items { id }
      total
    }
  }
`;

/** Link eligibility only; the existing Tester resolver remains authoritative. */
export async function testerLinkEligibility(
  client: GraphQLClient,
  agent: { id: string; organizationId: string | null },
  canManage: boolean | null,
): Promise<boolean | null> {
  if (canManage !== true || agent.organizationId !== null) return canManage;
  try {
    const owned = await fetchAllItems<{ id: string }>(client, TESTER_OWNED_AGENT_IDS_QUERY, 'agents');
    return owned.some((a) => a.id === agent.id);
  } catch {
    // Unknown is distinct from "not owned"; either hides this optional link.
    console.warn('[agent-page] Tester ownership read failed; link eligibility unknown');
    return null;
  }
}
