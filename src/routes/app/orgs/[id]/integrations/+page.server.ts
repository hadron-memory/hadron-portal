import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  AI_SERVICE_CONFIGS_QUERY,
  LINK_GITHUB_APP_MUTATION,
  UPDATE_ORG_GITHUB_APP_MUTATION,
  UNLINK_GITHUB_APP_MUTATION,
  DELETE_EXCHANGE_CONNECTION_MUTATION,
  TEST_EXCHANGE_CONNECTION_MUTATION,
} from '$lib/server/queries';
import type { AiServiceConfig } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// #336: Integrations tab — GitHub App + Microsoft Exchange + AI service configs,
// previously split across the org dashboard (GitHub/Exchange) and the
// /ai-configs route (which now redirects here).
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  // The org (incl. 404 handling) is already loaded by +layout.server.ts; pull
  // it from parent() instead of re-issuing ORGANIZATION_QUERY.
  const { org } = await parent();
  // The registry list is org-ADMIN gated server-side; non-admin members get a
  // GraphQL error here — surface it as an empty/error state, not a 500.
  const configsData = await fetchAllItems<AiServiceConfig>(
    gqlClient(locals.token), AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs',
    { ownerType: 'ORGANIZATION', ownerId: params.id },
  ).catch(() => null);
  return {
    org,
    configs: configsData ?? [],
    configsError: configsData === null,
    currentUserId: locals.user?.id ?? null,
  };
};

export const actions: Actions = {
  linkGithub: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const installationId = parseInt(String(fd.get('installationId') ?? ''), 10);
    if (!installationId || isNaN(installationId)) {
      return fail(400, { error: 'Installation ID must be a number' });
    }
    try {
      await gqlClient(locals.token).request(LINK_GITHUB_APP_MUTATION, {
        orgId: params.id,
        installationId,
      });
      return { githubLinked: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to link GitHub App') });
    }
  },

  updateGithubApp: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const appId = String(fd.get('appId') ?? '').trim();
    const privateKey = String(fd.get('privateKey') ?? '').trim();
    if (!appId || !privateKey) {
      return fail(400, { error: 'App ID and Private Key are required' });
    }
    try {
      await gqlClient(locals.token).request(UPDATE_ORG_GITHUB_APP_MUTATION, {
        orgId: params.id,
        appId,
        privateKey,
      });
      return { githubAppSaved: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to save GitHub App credentials') });
    }
  },

  unlinkGithub: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(UNLINK_GITHUB_APP_MUTATION, {
        orgId: params.id,
      });
      return { githubUnlinked: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to unlink GitHub App') });
    }
  },

  connectExchange: async ({ params, locals }) => {
    // #477 Sink 2: start Microsoft OAuth server-to-server with the Bearer token
    // (over LOCAL_SERVER_URL) and get back a single-use nonce, THEN redirect the
    // browser (to PUBLIC_SERVER_URL) with only the nonce. The 30-day JWT never
    // rides in the browser URL / access logs.
    const localUrl = env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
    const publicUrl = publicEnv.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
    const integrationsPath = `/app/orgs/${params.id}/integrations`;

    let nonce: string;
    try {
      const res = await fetch(`${localUrl}/auth/microsoft/start`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${locals.token}`,
        },
        body: JSON.stringify({ orgId: params.id, redirect: integrationsPath }),
      });
      if (!res.ok) {
        return fail(res.status, { exchangeError: 'Failed to start Microsoft sign-in.' });
      }
      ({ nonce } = (await res.json()) as { nonce: string });
    } catch {
      return fail(500, { exchangeError: 'Could not reach the server to start sign-in.' });
    }
    // redirect() throws — must run outside the try so the catch can't swallow it.
    redirect(303, `${publicUrl}/auth/microsoft?nonce=${encodeURIComponent(nonce)}`);
  },

  deleteExchangeConnection: async ({ request, locals }) => {
    const fd = await request.formData();
    const connectionId = String(fd.get('connectionId') ?? '').trim();
    if (!connectionId) return fail(400, { exchangeError: 'Connection ID is required' });
    try {
      await gqlClient(locals.token).request(DELETE_EXCHANGE_CONNECTION_MUTATION, { id: connectionId });
      return { exchangeDeleted: true };
    } catch (e: unknown) {
      return fail(500, { exchangeError: extractGqlError(e, 'Failed to delete Exchange connection') });
    }
  },

  testExchangeConnection: async ({ request, locals }) => {
    const fd = await request.formData();
    const connectionId = String(fd.get('connectionId') ?? '').trim();
    if (!connectionId) return fail(400, { exchangeError: 'Connection ID is required' });
    try {
      await gqlClient(locals.token).request(TEST_EXCHANGE_CONNECTION_MUTATION, { id: connectionId });
      return { exchangeTested: true };
    } catch (e: unknown) {
      return fail(500, { exchangeError: extractGqlError(e, 'Exchange connection test failed') });
    }
  },
};
