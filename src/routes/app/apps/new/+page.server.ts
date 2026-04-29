import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_APP_MUTATION, UPDATE_APP_MUTATION, MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token)
    .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));
  return { orgs: data.myOrganizations };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fd = await request.formData();
    const urn = String(fd.get('urn') ?? '').trim();
    const displayName = String(fd.get('displayName') ?? '').trim();
    const name = urn || displayName;
    const appType = String(fd.get('appType') ?? 'WORKSTATION');
    const role = String(fd.get('role') ?? 'READER');
    const organizationId = String(fd.get('organizationId') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const expiresAt = String(fd.get('expiresAt') ?? '').trim() || null;
    const agentTools = fd.getAll('agentTools').map(String);

    if (!name) return fail(400, { error: 'Name is required' });

    if (!organizationId) return fail(400, { error: 'Organization is required' });

    try {
      const data = await gqlClient(locals.token).request<{ createApp: { id: string } }>(
        CREATE_APP_MUTATION,
        { orgId: organizationId, name, appType, role, description, expiresAt, agentTools },
      );
      if (displayName && displayName !== name) {
        await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
          id: data.createApp.id, name: displayName,
        }).catch(() => {});
      }
      redirect(303, `/app/apps/${data.createApp.id}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create app' });
    }
  },
};
