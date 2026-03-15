import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ORGANIZATION_QUERY, LINK_GITHUB_APP_MUTATION, UPDATE_ORG_GITHUB_APP_MUTATION, UNLINK_GITHUB_APP_MUTATION } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY,
    { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });

  if (!data.organization) throw error(404, 'Organization not found');
  return { org: data.organization };
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
};
