// 009-install-agent-flow T021: the legacy ?/create action that pairs with
// the removed "+ New App" form is gone. App creation now lives at the
// install route /app/orgs/[id]/agents/install/[aid]/ — see FR-004.
import { fail, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  APPS_QUERY,
  DELETE_APP_MUTATION,
} from '$lib/server/queries';
import type { Organization, App } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

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
