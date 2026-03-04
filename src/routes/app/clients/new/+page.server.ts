import { redirect, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_CLIENT_MUTATION, MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token)
    .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));
  return { orgs: data.myOrganizations };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fd = await request.formData();
    const label = String(fd.get('label') ?? '').trim();
    const type = String(fd.get('type') ?? 'WORKSTATION');
    const roles = fd.getAll('roles').map(String);
    const organizationId = String(fd.get('organizationId') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const namespace = String(fd.get('namespace') ?? '').trim() || null;
    const expiresAt = String(fd.get('expiresAt') ?? '').trim() || null;

    if (!label) return fail(400, { error: 'Label is required' });
    if (roles.length === 0) return fail(400, { error: 'At least one role is required' });

    try {
      const data = await gqlClient(locals.token).request<{ createClient: { client: { id: string }; rawKey: string } }>(
        CREATE_CLIENT_MUTATION,
        { label, type, roles, organizationId, userId: locals.user?.id ?? null, description, namespace, expiresAt },
      );
      // Pass the rawKey via search param so the detail page can show it once
      redirect(303, `/app/clients/${data.createClient.client.id}?newKey=${encodeURIComponent(data.createClient.rawKey)}`);
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create client' });
    }
  },
};
