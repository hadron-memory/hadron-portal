import type { GraphQLClient } from 'graphql-request';
import { fetchAllItems } from '$lib/server/paginate';
import { findOrgListedAgent } from './resolve-agent';

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
  if (canManage !== true) return canManage;
  if (agent.organizationId !== null) {
    // #2187: an org-owned Agent opens in the Tester only where the Tester's own
    // org lookup finds it; a PERSONAL one is creator-only, even to managers.
    try {
      return (await findOrgListedAgent(client, agent.id)) !== null;
    } catch {
      console.warn('[agent-page] Tester org reach read failed; link eligibility unknown');
      return null;
    }
  }
  try {
    const owned = await fetchAllItems<{ id: string }>(client, TESTER_OWNED_AGENT_IDS_QUERY, 'agents');
    return owned.some((a) => a.id === agent.id);
  } catch {
    // Unknown is distinct from "not owned"; either hides this optional link.
    console.warn('[agent-page] Tester ownership read failed; link eligibility unknown');
    return null;
  }
}
