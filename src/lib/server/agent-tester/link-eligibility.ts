import type { GraphQLClient } from 'graphql-request';
import { fetchAllItems } from '$lib/server/paginate';
import type { Organization } from '$lib/types';
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
  orgs: Organization[],
): Promise<boolean | null> {
  // Only the boolean true proves management (the Tester's canManageStrict is
  // `canManage === true`). false stays false; null and anything else is unknown.
  if (canManage !== true) return canManage === false ? false : null;
  // #2187: the Tester's own two-step reach (resolve-agent findVisibleAgent): the
  // caller's org agents list first (a PERSONAL Agent only to its creator), then
  // the owned-by-me list. `orgs` is the list the page already loaded, so the
  // common case adds no request; the owned read runs only when the org list
  // misses (and always for a user-owned Agent, which has no org list).
  if (agent.organizationId !== null && findOrgListedAgent(orgs, agent.id) !== null) return true;
  try {
    const owned = await fetchAllItems<{ id: string }>(client, TESTER_OWNED_AGENT_IDS_QUERY, 'agents');
    return owned.some((a) => a.id === agent.id);
  } catch {
    // Unknown is distinct from "not owned"; either hides this optional link.
    console.warn('[agent-page] Tester ownership read failed; link eligibility unknown');
    return null;
  }
}
