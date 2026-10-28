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

const liveGrant = (g: NonNullable<OrgAgentPool['agentOrgGrants']>[number], now: number) =>
  g.isActive && !g.revokedAt && !(g.expiresAt && Date.parse(g.expiresAt) <= now);

/**
 * The agents the org SUBSCRIBES to: an active, unrevoked, unexpired grant whose
 * agent the caller may read. isActive is the server's word; the two dates are
 * checked as well so a grant the server has not yet swept is not offered. Each
 * agent once.
 */
export function grantedAgents(org: OrgAgentPool, now: number = Date.now()): InstallableAgent[] {
  const seen = new Set<string>();
  return (org.agentOrgGrants ?? [])
    .filter((g) => liveGrant(g, now) && g.agent)
    .map((g) => g.agent as InstallableAgent)
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/** Owned agents first, then the granted ones, each agent once (the App picker). */
export function mergeInstallableAgents(org: OrgAgentPool, now: number = Date.now()): InstallableAgent[] {
  const seen = new Set<string>();
  return [...org.agents, ...grantedAgents(org, now)].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}
