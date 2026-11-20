import { extractGqlError, extractGqlErrorCode, gqlErrorBody } from '$lib/server/gqlError';
import { redirect, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { LINK_GITHUB_APP_MUTATION } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/**
 * GitHub App installation callback.
 *
 * After a user installs the official Hadron GitHub App, GitHub redirects here with:
 *   ?installation_id=123456&setup_action=install&state=<orgId>
 *
 * We link the installation to the organization and redirect back to the org page.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
  const installationId = parseInt(url.searchParams.get('installation_id') ?? '', 10);
  const orgId = url.searchParams.get('state') ?? '';

  if (!installationId || isNaN(installationId) || !orgId) {
    throw error(400, 'Missing installation_id or organization context');
  }

  try {
    await gqlClient(locals.token).request(LINK_GITHUB_APP_MUTATION, {
      orgRef: orgId,
      installationId,
    });
  } catch (e: unknown) {
    const fallback = 'Failed to link GitHub App installation';
    throw error(500, extractGqlErrorCode(e) === 'INTERNAL_SERVER_ERROR'
      ? gqlErrorBody(e, fallback)
      : { message: extractGqlError(e, fallback) });
  }

  // #336: GitHub config + success banner live on the Integrations tab.
  redirect(303, `/app/orgs/${orgId}/integrations?githubInstalled=1`);
};
