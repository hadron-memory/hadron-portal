import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  APPS_QUERY,
  LINK_GITHUB_APP_MUTATION,
  UPDATE_ORG_GITHUB_APP_MUTATION,
  UNLINK_GITHUB_APP_MUTATION,
  DELETE_EXCHANGE_CONNECTION_MUTATION,
  TEST_EXCHANGE_CONNECTION_MUTATION,
} from '$lib/server/queries';
import type { Organization, App } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

// 015-fix-org-apps-count: ORGANIZATION_QUERY does not select `apps` (it's
// shared by ~10 routes that don't need apps and would overfetch APP_FIELDS).
// Issue APPS_QUERY in parallel and surface failure inline (FR-006).
//
// Per code-review feedback on #213: await the org request first so an
// invalid/missing org id returns 404 immediately instead of waiting for
// the (potentially slow) apps request. The apps request is still kicked
// off in parallel; we only await its settlement after the org check.
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  // Fire both in parallel; attach a no-op catch on apps so an early org
  // throw doesn't leave the apps promise as an unhandled rejection.
  const appsPromise = client.request<{ apps: App[] }>(APPS_QUERY, { orgId: params.id });
  appsPromise.catch(() => { /* result inspected below */ });

  let orgResult: { organization: Organization | null };
  try {
    orgResult = await client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id });
  } catch {
    throw error(404, 'Organization not found');
  }
  if (!orgResult.organization) throw error(404, 'Organization not found');

  try {
    const appsResult = await appsPromise;
    return { org: orgResult.organization, apps: appsResult.apps, appsError: null };
  } catch (e: unknown) {
    return {
      org: orgResult.organization,
      apps: [] as App[],
      appsError: extractGqlError(e, 'Failed to load apps'),
    };
  }
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
    // Redirect to hadron-server's Microsoft OAuth endpoint
    const serverUrl = env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
    const orgPagePath = `/app/orgs/${params.id}`;
    const authUrl = `${serverUrl}/auth/microsoft?orgId=${params.id}&redirect=${encodeURIComponent(orgPagePath)}&token=${locals.token}`;
    redirect(303, authUrl);
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
