import { fetchAllItems } from '$lib/server/paginate';
import { MY_AGENTS_QUERY, ORGANIZATIONS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
import type { Agent, Organization } from '$lib/types';
import type { gqlClient } from '$lib/server/api';

type TesterAgent = Pick<Agent, 'id' | 'name' | 'urn' | 'organizationId' | 'systemMemoryId'>;

/**
 * May the caller manage this Agent, by the server's own `effectiveAccess`?
 * Unlike `selfCanManage` (which turns a failed read into "unknown" so a form
 * can still be offered), a failed read here THROWS: the Tester must never admit
 * on an unknown, and an outage must not read as a 404 either.
 */
async function canManageStrict(client: ReturnType<typeof gqlClient>, userId: string, agentUrn: string): Promise<boolean> {
  const r = await client.request<{ effectiveAccess: { canManage: boolean } | null }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource: agentUrn });
  return r.effectiveAccess?.canManage === true;
}

/**
 * The ONE gate every Tester surface goes through (portal#2099). Resolve an agent the caller may use (portal#2083: only one the
 * caller can MANAGE, since after hadron-server#4095 `startChat` refuses a
 * non-manager the Tester has no licensed App chat home to admit). The organization list
 * preserves its original member/admin scope; ownedByMe adds only the caller's
 * own user-owned agents, including when the caller is a platform admin.
 * Public find-one reads are deliberately outside this tester access path.
 * A non-manager, or no user, is a miss (the surface's own not-found). Let
 * lookup and manage-read failures propagate so a temporary outage never becomes
 * a 404 or an admission. The server stays authoritative on every start.
 */
export async function requireTesterAgent(
  client: ReturnType<typeof gqlClient>,
  userId: string | null | undefined,
  agentId: string,
): Promise<{ agent: TesterAgent; org: Organization | null } | null> {
  // No user is a miss, decided before any lookup: nothing to ask the server about.
  if (!userId) return null;
  const found = await findVisibleAgent(client, agentId);
  if (!found) return null;
  return (await canManageStrict(client, userId, found.agent.urn)) ? found : null;
}

/**
 * The caller's organizations with their agents, exactly as the Tester reads
 * them. The Agent page's loader and the Tester's lookup both call this, so the
 * Tester link and the Tester cannot drift apart (portal#2187). A failed read
 * throws: nothing downstream may treat it as an empty list.
 */
export function loadTesterOrgs(client: ReturnType<typeof gqlClient>): Promise<Organization[]> {
  return fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');
}

/**
 * The Tester's org-Agent reach, as a pure predicate over the caller's
 * `organizations { agents }` list (a PERSONAL Agent appears only to its
 * creator). Shared with the Agent page's link eligibility, which already holds
 * that list, so the link cannot drift from the Tester.
 */
export function findOrgListedAgent(
  orgs: Organization[],
  agentId: string,
): { agent: TesterAgent; org: Organization } | null {
  for (const org of orgs) {
    const agent = (org.agents ?? []).find((a) => a.id === agentId);
    if (agent) return { agent, org };
  }
  return null;
}

async function findVisibleAgent(
  client: ReturnType<typeof gqlClient>,
  agentId: string,
): Promise<{ agent: TesterAgent; org: Organization | null } | null> {
  const orgs = await loadTesterOrgs(client);
  const inOrg = findOrgListedAgent(orgs, agentId);
  if (inOrg) return inOrg;

  const owned = await fetchAllItems<TesterAgent>(client, MY_AGENTS_QUERY, 'agents');
  const agent = owned.find((a) => a.id === agentId);
  return agent ? { agent, org: null } : null;
}
