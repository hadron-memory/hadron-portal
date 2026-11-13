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
 * Resolve an agent the caller may use in the Tester (portal#2083: only one the
 * caller can MANAGE, since after hadron-server#4095 `startChat` refuses a
 * non-manager the Tester has no licensed App chat home to admit). The organization list
 * preserves its original member/admin scope; ownedByMe adds only the caller's
 * own user-owned agents, including when the caller is a platform admin.
 * Public find-one reads are deliberately outside this tester access path.
 * A non-manager, or no user, is a miss (the surface's own not-found). Let
 * lookup and manage-read failures propagate so a temporary outage never becomes
 * a 404 or an admission. The server stays authoritative on every start.
 */
export async function resolveTesterAgent(
  client: ReturnType<typeof gqlClient>,
  agentId: string,
  userId: string | null | undefined,
): Promise<{ agent: TesterAgent; org: Organization | null } | null> {
  // No user is a miss, decided before any lookup: nothing to ask the server about.
  if (!userId) return null;
  const found = await findVisibleAgent(client, agentId);
  if (!found) return null;
  return (await canManageStrict(client, userId, found.agent.urn)) ? found : null;
}

async function findVisibleAgent(
  client: ReturnType<typeof gqlClient>,
  agentId: string,
): Promise<{ agent: TesterAgent; org: Organization | null } | null> {
  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');
  for (const org of orgs) {
    const agent = (org.agents ?? []).find((a) => a.id === agentId);
    if (agent) return { agent, org };
  }

  const owned = await fetchAllItems<TesterAgent>(client, MY_AGENTS_QUERY, 'agents');
  const agent = owned.find((a) => a.id === agentId);
  return agent ? { agent, org: null } : null;
}

/** A fixture requires an addressable system memory in addition to access. */
export async function resolveTesterSystemMemory(
  client: ReturnType<typeof gqlClient>,
  agentId: string,
  userId: string | null | undefined,
): Promise<string | null> {
  const resolved = await resolveTesterAgent(client, agentId, userId);
  return resolved?.agent.systemMemoryId ?? null;
}
