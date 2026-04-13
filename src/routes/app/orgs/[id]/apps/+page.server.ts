import { fail, redirect, isRedirect, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  APPS_QUERY,
  CREATE_APP_MUTATION,
  DELETE_APP_MUTATION,
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

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [orgData, appsData] = await Promise.all([
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => { throw error(404, 'Organization not found'); }),
    client.request<{ apps: App[] }>(APPS_QUERY, { orgId: params.id })
      .catch(() => ({ apps: [] as App[] })),
  ]);
  if (!orgData.organization) throw error(404, 'Organization not found');
  return { org: orgData.organization, apps: appsData.apps };
};

export const actions: Actions = {
  create: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const createUserPermission = String(fd.get('createUserPermission') ?? 'EXPLICIT');
    const identifyUserMethod = String(fd.get('identifyUserMethod') ?? 'USER_ID');
    const sessionTimeoutSeconds = Number(fd.get('sessionTimeoutSeconds') ?? 900);
    const anonymousTtlDays = Number(fd.get('anonymousTtlDays') ?? 7);
    if (!name) return fail(400, { error: 'Name is required' });

    try {
      const result = await gqlClient(locals.token).request<{ createApp: App }>(
        CREATE_APP_MUTATION,
        {
          orgId: params.id,
          name,
          createUserPermission,
          identifyUserMethod,
          sessionTimeoutSeconds,
          anonymousTtlDays,
        },
      );
      redirect(303, `/app/orgs/${params.id}/apps/${result.createApp.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: extractGqlError(e, 'Failed to create app') });
    }
  },

  delete: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      await gqlClient(locals.token).request(DELETE_APP_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to delete app') });
    }
  },
};
