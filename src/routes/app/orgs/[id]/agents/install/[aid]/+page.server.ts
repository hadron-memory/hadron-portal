/**
 * 009-install-agent-flow — install form route.
 *
 * Path: /app/orgs/[id]/agents/install/[aid]/
 *
 * `load` reads the org and the Agent, computes default name + URN
 * (collision-aware via the install helpers), and rejects cross-org install
 * attempts at the portal layer (the server preserves 008's auto-grant
 * behavior — see specs/009-install-agent-flow/research.md R-2).
 *
 * The `?/install` action calls CREATE_APP_MUTATION with `agentId` set, then
 * redirects to the new App's manage page on success.
 */

import { error, fail, redirect, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  APPS_QUERY,
  CREATE_APP_MUTATION,
} from '$lib/server/queries';
import { deriveDefaultUrn } from '$lib/install/derive-default-urn';
import { deriveDefaultName } from '$lib/install/derive-default-name';
import { installStrings } from '$lib/i18n/install-strings';
import type { Organization, App, Agent } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

function agentSlugFromUrn(agentUrn: string): string {
  // Agent URN shape: "{org-urn}:{slug}". Take everything after the first colon.
  const colon = agentUrn.indexOf(':');
  return colon >= 0 ? agentUrn.slice(colon + 1) : agentUrn;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const [orgData, appsData] = await Promise.all([
    client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => {
        throw error(404, 'Organization not found');
      }),
    client
      .request<{ apps: App[] }>(APPS_QUERY, { orgId: params.id })
      .catch(() => ({ apps: [] as App[] })),
  ]);
  if (!orgData.organization) throw error(404, 'Organization not found');
  const org = orgData.organization;

  const agent = (org.agents ?? []).find((a: Agent) => a.id === params.aid);
  if (!agent) {
    // 009 cross-org install gate (portal-only): if the Agent isn't in this
    // org's agents list, refuse to render the form. Server preserves 008's
    // auto-grant behavior, so this is the user-visible boundary.
    throw error(404, installStrings.errorCrossOrg());
  }

  const existingApps = appsData.apps ?? [];
  const existingUrns = existingApps.map((a) => a.urn);
  const existingNames = existingApps.map((a) => a.name);
  const slug = agentSlugFromUrn(agent.urn);
  const defaultUrn = deriveDefaultUrn(org.urn, slug, existingUrns);
  const defaultName = deriveDefaultName(agent.name, existingNames);
  const defaultUrnSlug = defaultUrn.startsWith(org.urn + ':')
    ? defaultUrn.slice(org.urn.length + 1)
    : defaultUrn;

  return {
    org,
    agent,
    defaultName,
    defaultUrnSlug,
  };
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
    let createdApp: App;
    try {
      const result = await client.request<{ createApp: App }>(CREATE_APP_MUTATION, {
        orgId: params.id,
        agentId: params.aid,
        name,
        urn,
        appType,
      });
      createdApp = result.createApp;
    } catch (e) {
      const msg = extractGqlError(e, 'Install failed.');
      // Friendly mappings for the common cases — server still has the final
      // word; we just translate its message into a user-facing string.
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
