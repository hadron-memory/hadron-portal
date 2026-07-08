import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, ORG_APP_INSTALLS_QUERY, ORG_AGENT_GRANTS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

type AppInstall = { id: string; name: string; agentId: string | null };

/** One AgentOrgGrant row as the Subscribed tab consumes it (#486). */
export interface AgentGrant {
  agentId: string;
  activatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
  createdAt: string;
  agent: {
    id: string;
    urn: string;
    name: string;
    description: string | null;
    organizationId: string;
  } | null;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [data, apps, grantsData] = await Promise.all([
    // Let transient GraphQL/network errors propagate (→ 500); a genuinely
    // missing org is handled by the `!data.organization` 404 below. (Coercing
    // every error to 404 here would hide real failures — the spec-018 lesson.)
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id }),
    // Which agents are already installed as an App → { agentId: { appId, appName } }.
    // Non-fatal: on failure the "Open" affordance simply doesn't render.
    fetchAllItems<AppInstall>(client, ORG_APP_INSTALLS_QUERY, 'apps', { orgId: params.id }).catch(
      () => [] as AppInstall[],
    ),
    // Subscribed tab (#486): the org's AgentOrgGrants. The server resolver
    // returns [] for non-admins (no error), so a thrown error here is a real
    // transport failure — coerce to null so the tab shows "unavailable"
    // rather than a false "no subscriptions" (review:no-silent-loader-catch).
    client
      .request<{ organization: { agentOrgGrants: AgentGrant[] } | null }>(
        ORG_AGENT_GRANTS_QUERY, { id: params.id },
      )
      .then((r) => r.organization?.agentOrgGrants ?? [])
      .catch((e) => {
        console.warn(`[org-agents] grants fetch failed for ${params.id}:`, e);
        return null;
      }),
  ]);

  if (!data.organization) throw error(404, 'Organization not found');

  // First install wins if an agent is installed in more than one app.
  const installedByAgent: Record<string, { appId: string; appName: string }> = {};
  for (const app of apps) {
    if (app.agentId && !installedByAgent[app.agentId]) {
      installedByAgent[app.agentId] = { appId: app.id, appName: app.name };
    }
  }

  // "Subscribed" = grants for agents OWNED BY OTHER ORGS (#486). Grants for
  // the org's own agents (auto-provisioned by every install) are noise here.
  const subscribedGrants =
    grantsData === null
      ? null
      : grantsData.filter((g) => g.agent && g.agent.organizationId !== params.id);

  return { org: data.organization, installedByAgent, subscribedGrants };
};
