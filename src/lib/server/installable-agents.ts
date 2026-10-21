/**
 * The agents an org can put to use: the ones it owns plus the ones it
 * subscribes to (#1172). A subscription is an `AgentOrgGrant`, not a member of
 * `organization.agents`, yet `installAgentIntoApp` and `publishAgentImport`
 * accept it. Read from APP_ORG_AGENTS_QUERY; an inactive grant, or one whose
 * agent the caller may not read (`agent: null`), is not offered. Each agent
 * appears once, owned first.
 */
export type InstallableAgent = { id: string; name: string; urn: string };

export type OrgAgentPool = {
  agents: InstallableAgent[];
  agentOrgGrants?: Array<{
    isActive: boolean;
    revokedAt?: string | null;
    expiresAt?: string | null;
    agent: InstallableAgent | null;
  }>;
};

export function mergeInstallableAgents(org: OrgAgentPool, now: number = Date.now()): InstallableAgent[] {
  // Active, unrevoked and unexpired: isActive is the server's word, and the two
  // dates are checked as well so a grant the server has not yet swept is not
  // offered.
  const live = (g: NonNullable<OrgAgentPool['agentOrgGrants']>[number]) =>
    g.isActive && !g.revokedAt && !(g.expiresAt && Date.parse(g.expiresAt) <= now);
  const subscribed = (org.agentOrgGrants ?? [])
    .filter((g) => live(g) && g.agent)
    .map((g) => g.agent as InstallableAgent);
  const seen = new Set<string>();
  return [...org.agents, ...subscribed].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}
