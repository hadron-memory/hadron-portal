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
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { classifyGqlError, gqlErrorTextForBranching, extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { CREATE_APP_REFUSALS } from '$lib/server/create-app-refusals';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATIONS_QUERY,
  AGENT_PUBLIC_QUERY,
  CREATE_APP_MUTATION,
  INSTALL_AGENT_INTO_APP_MUTATION,
  ORG_APPS_FOR_REGISTER_QUERY,
} from '$lib/server/queries';
import { deriveDefaultUrn } from '$lib/install/derive-default-urn';
import { deriveDefaultName } from '$lib/install/derive-default-name';
import { installStrings } from '$lib/i18n/install-strings';
import type { Organization, Agent, App } from '$lib/types';
import { t } from '$lib/i18n/t';
import type { Actions, PageServerLoad } from './$types';
import { installAgentSchema, installExistingAppSchema } from './schema';

type AppChoice = Pick<App, 'id' | 'name' | 'urn'>;
type InstallAgentForm = Infer<typeof installAgentSchema, 'zod4'>;

const installAgentFormAdapter = zod4(installAgentSchema);

// The slug is the LAST ':'-segment (PR-499 review): a canonical agent URN is
// hrn:agent:<org>::<slug> — the first-colon slice this used to do returned
// "agent:<org>::<slug>" for the marketplace path and fed a malformed default
// app slug into the install form. Same approach as the agent detail page's
// slugOfUrn; also correct for the legacy <org>:<slug> shape.
function agentSlugFromUrn(agentUrn: string): string {
  const colon = agentUrn.lastIndexOf(':');
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
  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');

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
  // admission gate, not the query succeeding. A transport failure propagates
  // rather than masquerading as an absent Agent.
  const publicAgent = await client
    .request<{ agent: (InstallableAgent & { visibility: string }) | null }>(
      AGENT_PUBLIC_QUERY, { ref: agentIdParam },
    )
    .then((r) => r.agent)
    .catch((err: unknown) => {
      // Preserve the existing concealed-not-found response for typed Agent
      // refusals. An unavailable backend is not evidence of a missing Agent.
      const code = extractGqlErrorCode(err);
      if (code && ['FORBIDDEN', 'PERMISSION_DENIED', 'NOT_FOUND', 'AGENT_NOT_FOUND', 'BAD_USER_INPUT', 'URN_NOT_QUALIFIED'].includes(code)) return null;
      throw err;
    });
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

  let existingApps: AppChoice[] = [];
  let existingAppsFailed = false;
  try {
    existingApps = await fetchAllItems<AppChoice>(client, ORG_APPS_FOR_REGISTER_QUERY, 'apps', { orgId: org.id });
  } catch {
    existingAppsFailed = true;
  }
  return {
    existingApps, existingAppsFailed,
    existingAppForm: await superValidate({ appId: '' }, zod4(installExistingAppSchema), { id: 'installExistingApp', errors: false }),
    org,
    agent,
    defaultName,
    defaultUrnSlug,
    form: await superValidate<InstallAgentForm>(
      { name: defaultName, urn: defaultUrnSlug, appType: 'WORKSTATION' },
      installAgentFormAdapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  installExisting: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(installExistingAppSchema), { id: 'installExistingApp', strict: true });
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);
    try {
      // The POST must independently recheck both the agent admission and the
      // selected App's org. Page data is only a picker, never authorization.
      const target = await resolveInstallTarget(client, params.id, params.aid);
      if (!target.ok) return message(form, { type: 'error', text: installStrings.errorAgentNotFound() }, { status: 404 });
      const apps = await fetchAllItems<AppChoice>(client, ORG_APPS_FOR_REGISTER_QUERY, 'apps', { orgId: target.org.id });
      const app = apps.find((a) => a.id === form.data.appId);
      if (!app) return setError(form, 'appId', t('install.existing.invalid', 'Choose an App in this organization.'), { status: 400 });
      await client.request(INSTALL_AGENT_INTO_APP_MUTATION, { appRef: app.id, agentRef: target.agent.id });
    } catch (err) {
      const code = extractGqlErrorCode(err);
      if (code === 'DUPLICATE_APP_AGENT') return setError(form, 'appId', t('install.existing.duplicate', 'This agent is already installed in that App.'), { status: 409 });
      if (code === 'FORBIDDEN' || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') {
        return message(form, { type: 'error', text: t('install.existing.forbidden', 'You do not have permission to install this agent into that App.') }, { status: 403 });
      }
      // No raw ClientError: it includes the request and may carry credentials.
      return message(form, { type: 'error', text: t('install.existing.failed', 'Could not install the agent. Your selection is kept; try again.') }, { status: 503 });
    }
    redirect(303, `/app/apps/${form.data.appId}`);
  },
  install: async ({ request, params, locals }) => {
    const form = await superValidate<InstallAgentForm>(
      await request.formData(),
      installAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);

    // Re-run the cross-org check inside the action — load()'s check doesn't
    // run on POST. A crafted direct POST to this route would otherwise
    // bypass the portal-only gate (per hadron-portal#191 review).
    const target = await resolveInstallTarget(client, params.id, params.aid);
    if (!target.ok) {
      if (target.reason === 'cross-org') {
        return message(form, { type: 'error', text: installStrings.errorCrossOrg() }, { status: 403 });
      }
      if (target.reason === 'agent-not-found') {
        return message(form, { type: 'error', text: installStrings.errorAgentNotFound() }, { status: 404 });
      }
      return message(form, { type: 'error', text: 'Organization not found.' }, { status: 404 });
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
    const { name, urn, appType } = form.data;
    const surfaces = appType === 'CHATBOT' ? ['chat'] : ['mcp'];

    let createdApp: App;
    try {
      const result = await client.request<{ createApp: App }>(CREATE_APP_MUTATION, {
        orgRef: params.id,
        agentRef: params.aid,
        name,
        urn,
        appType,
        surfaces,
      });
      createdApp = result.createApp;
    } catch (e) {
      const msg = extractGqlError(e, 'Install failed.', CREATE_APP_REFUSALS);
      if (/already exists/i.test(gqlErrorTextForBranching(e))) {
        return setError(form, 'urn', installStrings.errorUrnCollision(), { status: 409 });
      }
      if (extractGqlErrorCode(e) === 'AGENT_NOT_FOUND' || /Agent not found|deleted/i.test(gqlErrorTextForBranching(e))) {
        return message(form, { type: 'error', text: installStrings.errorAgentNotFound() }, { status: 404 });
      }
      return message(form, { type: 'error', text: msg }, { status: classifyGqlError(e).kind === 'transport' || (CREATE_APP_REFUSALS as readonly string[]).includes(extractGqlErrorCode(e) ?? '') ? 400 : 500 });
    }

    // #648: the App detail is the canonical org-optional /app/apps/[appId].
    throw redirect(303, `/app/apps/${createdApp.id}`);
  },
};
