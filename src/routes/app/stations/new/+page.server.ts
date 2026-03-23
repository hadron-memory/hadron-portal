import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_STATION_MUTATION, MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
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
    const label = String(fd.get('label') ?? '').trim();
    const stationType = String(fd.get('stationType') ?? 'WORKSTATION');
    const role = String(fd.get('role') ?? 'READER');
    const organizationId = String(fd.get('organizationId') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const namespace = String(fd.get('namespace') ?? '').trim() || null;
    const expiresAt = String(fd.get('expiresAt') ?? '').trim() || null;
    const agentTools = fd.getAll('agentTools').map(String);

    if (!label) return fail(400, { error: 'Label is required' });

    try {
      const data = await gqlClient(locals.token).request<{ createStation: { station: { id: string }; rawKey: string } }>(
        CREATE_STATION_MUTATION,
        { label, stationType, role, organizationId, userId: locals.user?.id ?? null, description, namespace, expiresAt, agentTools },
      );
      // Pass the rawKey via search param so the detail page can show it once
      redirect(303, `/app/stations/${data.createStation.station.id}?newKey=${encodeURIComponent(data.createStation.rawKey)}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create station' });
    }
  },
};
