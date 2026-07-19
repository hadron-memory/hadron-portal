import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
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
import { githubAppCredentialsSchema, githubInstallationSchema } from './schema';

type GithubAppCredentialsForm = Infer<typeof githubAppCredentialsSchema, 'zod4'>;
type GithubInstallationForm = Infer<typeof githubInstallationSchema, 'zod4'>;

const githubAppCredentialsFormAdapter = zod4(githubAppCredentialsSchema);
const githubInstallationFormAdapter = zod4(githubInstallationSchema);

function scrubPrivateKey<T extends { data: { privateKey: string } }>(form: T): T {
  form.data.privateKey = '';
  return form;
}

// #336: Integrations tab — GitHub App + Microsoft Exchange + AI service configs,
// previously split across the org dashboard (GitHub/Exchange) and the
// /ai-configs route (which now redirects here).
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const parentDataPromise = parent();
  await requireNonConsumer(() => parentDataPromise);
  // The org (incl. 404 handling) is already loaded by +layout.server.ts; pull
  // it from parent() instead of re-issuing ORGANIZATION_QUERY.
  const { org } = await parentDataPromise;
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
    githubAppForm: await superValidate<GithubAppCredentialsForm>(
      { appId: org.githubAppId ?? '', privateKey: '' },
      githubAppCredentialsFormAdapter,
      { errors: false },
    ),
    githubInstallationForm: await superValidate<GithubInstallationForm>(
      { installationId: org.githubInstallationId ? String(org.githubInstallationId) : '' },
      githubInstallationFormAdapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  linkGithub: async ({ request, params, locals }) => {
    const form = await superValidate<GithubInstallationForm>(
      await request.formData(),
      githubInstallationFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(LINK_GITHUB_APP_MUTATION, {
        orgId: params.id,
        installationId: Number(form.data.installationId),
      });
      return message(form, { type: 'success', text: t('org.integrations.github.linked', 'GitHub App installation linked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to link GitHub App') },
        { status: 500 },
      );
    }
  },

  updateGithubApp: async ({ request, params, locals }) => {
    const form = await superValidate<GithubAppCredentialsForm>(
      await request.formData(),
      githubAppCredentialsFormAdapter,
    );
    if (!form.valid) return fail(400, { form: scrubPrivateKey(form) });

    try {
      await gqlClient(locals.token).request(UPDATE_ORG_GITHUB_APP_MUTATION, {
        orgId: params.id,
        appId: form.data.appId,
        privateKey: form.data.privateKey,
      });
      return message(scrubPrivateKey(form), {
        type: 'success',
        text: t('org.integrations.github.credentialsSaved', 'GitHub App credentials saved.'),
      });
    } catch (e: unknown) {
      return message(
        scrubPrivateKey(form),
        { type: 'error', text: extractGqlError(e, 'Failed to save GitHub App credentials') },
        { status: 500 },
      );
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
