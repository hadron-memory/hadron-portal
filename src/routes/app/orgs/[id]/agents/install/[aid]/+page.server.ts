/**
 * 009-install-agent-flow — install form route.
 *
 * Path: /app/orgs/[id]/agents/install/[aid]/
 *
 * `load` reads the user's orgs (with agents), distinguishes "not found" from
 * "cross-org" (R3), and computes default name + URN. The same authority
 * check runs again in the `install` action so a crafted direct POST cannot
 * bypass the gate (R1).
 *
 * Server preserves 008's auto-grant on createApp; the portal is the
 * user-visible cross-org boundary (009 R-2). When the marketplace spec
 * lands, the server gains a hard gate and this portal-only check stops
 * being load-bearing.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATIONS_QUERY,
  AGENT_PUBLIC_QUERY,
  CREATE_APP_MUTATION,
} from '$lib/server/queries';
import { deriveDefaultUrn } from '$lib/install/derive-default-urn';
import { deriveDefaultName } from '$lib/install/derive-default-name';
import { installStrings } from '$lib/i18n/install-strings';
import type { Organization, Agent, App } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function agentSlugFromUrn(agentUrn: string): string {
  const colon = agentUrn.indexOf(':');
  return colon >= 0 ? agentUrn.slice(colon + 1) : agentUrn;
}

/** The agent fields the install form actually consumes — satisfied by both
 *  the member-org Agent payload and the slim PUBLIC read (#486). */
type InstallableAgent = Pick<Agent, 'id' | 'urn' | 'name' | 'description'>;

/**
 * Locate the Agent and verify the caller may install it into the target
 * org. Two admission paths (#486 / hadron-server#551):
 *   1. the agent belongs to the target org (the original 009 R-2 path);
 *   2. the agent is PUBLIC — the marketplace path (server #552 lifted the
 *      same-org restriction for PUBLIC agents; the AgentOrgGrant is
 *      auto-provisioned by createApp). A foreign NON-public agent is
 *      still rejected as cross-org.
 */
async function resolveInstallTarget(
  client: ReturnType<typeof gqlClient>,
  orgIdParam: string,
  agentIdParam: string,
): Promise<
  | { ok: true; org: Organization; agent: InstallableAgent; otherApps: App[] }
  | { ok: false; reason: 'org-not-found' | 'agent-not-found' | 'cross-org' }
> {
  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations')
    .catch(() => [] as Organization[]);

  const targetOrg = orgs.find((o) => o.id === orgIdParam);
  if (!targetOrg) return { ok: false, reason: 'org-not-found' };

  // Find the Agent in the target org first.
  const inTarget = (targetOrg.agents ?? []).find((a: Agent) => a.id === agentIdParam);
  if (inTarget) {
    return { ok: true, org: targetOrg, agent: inTarget, otherApps: targetOrg.apps ?? [] };
  }

  // The marketplace path: a PUBLIC agent installs cross-org. agent(ref:)
  // admits PUBLIC agents for any caller (server #552) — but it also admits
  // a member's own non-public agents, so the visibility check here is the
  // load-bearing gate, not the query succeeding. Best-effort: a transport
  // failure falls through to the member-org scan below.
  const publicAgent = await client
    .request<{ agent: (InstallableAgent & { visibility: string }) | null }>(
      AGENT_PUBLIC_QUERY, { id: agentIdParam },
    )
    .then((r) => r.agent)
    .catch(() => null);
  if (publicAgent && publicAgent.visibility === 'PUBLIC') {
    return { ok: true, org: targetOrg, agent: publicAgent, otherApps: targetOrg.apps ?? [] };
  }

  // Otherwise: does the Agent exist in any other org the user is a member of?
  for (const o of orgs) {
    if (o.id === targetOrg.id) continue;
    const found = (o.agents ?? []).find((a: Agent) => a.id === agentIdParam);
    if (found) return { ok: false, reason: 'cross-org' };
  }

  // Not found in any org the user can see.
  return { ok: false, reason: 'agent-not-found' };
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const result = await resolveInstallTarget(client, params.id, params.aid);
  if (!result.ok) {
    if (result.reason === 'cross-org') throw error(404, installStrings.errorCrossOrg());
    if (result.reason === 'agent-not-found') throw error(404, installStrings.errorAgentNotFound());
    throw error(404, 'Organization not found');
  }

  const { org, agent, otherApps } = result;
  const existingUrns = otherApps.map((a) => a.urn);
  const existingNames = otherApps.map((a) => a.name);
  const slug = agentSlugFromUrn(agent.urn);
  const defaultUrn = deriveDefaultUrn(org.urn, slug, existingUrns);
  const defaultName = deriveDefaultName(agent.name, existingNames);
  const defaultUrnSlug = defaultUrn.startsWith(org.urn + ':')
    ? defaultUrn.slice(org.urn.length + 1)
    : defaultUrn;

  return { org, agent, defaultName, defaultUrnSlug };
};

export const actions: Actions = {
  install: async ({ request, params, locals }) => {
    const data = await request.formData();
    const name = (data.get('name') ?? '').toString().trim();
    const urn = (data.get('urn') ?? '').toString().trim();
    const appType = (data.get('appType') ?? 'WORKSTATION').toString();

    if (!name) return fail(400, { error: 'Name is required.' });
    if (!urn) return fail(400, { error: 'URN is required.' });

    const client = gqlClient(locals.token);

    // Re-run the cross-org check inside the action — load()'s check doesn't
    // run on POST. A crafted direct POST to this route would otherwise
    // bypass the portal-only gate (per hadron-portal#191 review).
    const target = await resolveInstallTarget(client, params.id, params.aid);
    if (!target.ok) {
      if (target.reason === 'cross-org') {
        return fail(403, { error: installStrings.errorCrossOrg() });
      }
      if (target.reason === 'agent-not-found') {
        return fail(404, { error: installStrings.errorAgentNotFound() });
      }
      return fail(404, { error: 'Organization not found.' });
    }

    // Derive surfaces from appType so the App manage page surfaces the
    // right tabs. Without this, App.surfaces falls through to the schema
    // default ['chat'], which is wrong for non-CHATBOT installs and hides
    // the Client tab on WORKSTATION installs (where the
    // download-setup-zip flow lives). CHATBOT keeps 'chat'; everything
    // else gets 'mcp', which shows the non-chat manage tabs
    // (Memory/Settings/Client, not Chat). Surfaces are not currently
    // editable via the portal's UPDATE_APP_MUTATION; changing them later
    // requires the GraphQL API.
    const surfaces = appType === 'CHATBOT' ? ['chat'] : ['mcp'];

    let createdApp: App;
    try {
      const result = await client.request<{ createApp: App }>(CREATE_APP_MUTATION, {
        orgId: params.id,
        agentId: params.aid,
        name,
        urn,
        appType,
        surfaces,
      });
      createdApp = result.createApp;
    } catch (e) {
      const msg = extractGqlError(e, 'Install failed.');
      if (/already exists/i.test(msg)) {
        return fail(409, { error: installStrings.errorUrnCollision() });
      }
      if (/Agent not found|deleted/i.test(msg)) {
        return fail(404, { error: installStrings.errorAgentNotFound() });
      }
      return fail(400, { error: msg });
    }

    throw redirect(303, `/app/orgs/${params.id}/apps/${createdApp.id}`);
  },
};
