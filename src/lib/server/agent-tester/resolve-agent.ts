import { fetchAllItems } from '$lib/server/paginate';
import { MY_AGENTS_QUERY, ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Agent, Organization } from '$lib/types';
import type { gqlClient } from '$lib/server/api';

type TesterAgent = Pick<Agent, 'id' | 'name' | 'urn' | 'organizationId' | 'systemMemoryId'>;

/**
 * Resolve an agent the caller may use in the Tester. The organization list
 * preserves its original member/admin scope; ownedByMe adds only the caller's
 * own user-owned agents, including when the caller is a platform admin.
 * Public find-one reads are deliberately outside this tester access path.
 * Let lookup failures propagate so a temporary outage never becomes a 404.
 */
export async function resolveTesterAgent(
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
): Promise<string | null> {
  const resolved = await resolveTesterAgent(client, agentId);
  return resolved?.agent.systemMemoryId ?? null;
}
