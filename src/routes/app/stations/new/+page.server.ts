import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_STATION_MUTATION, UPDATE_STATION_MUTATION, MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
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
    const stationType = String(fd.get('stationType') ?? 'WORKSTATION');
    const role = String(fd.get('role') ?? 'READER');
    const organizationId = String(fd.get('organizationId') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const expiresAt = String(fd.get('expiresAt') ?? '').trim() || null;
    const agentTools = fd.getAll('agentTools').map(String);

    if (!name) return fail(400, { error: 'Name is required' });

    try {
      const data = await gqlClient(locals.token).request<{ createStation: { station: { id: string }; rawKey: string } }>(
        CREATE_STATION_MUTATION,
        { name, stationType, role, organizationId, userId: locals.user?.id ?? null, description, expiresAt, agentTools },
      );
      // If display name differs from slug, update the name to the human-friendly version
      if (displayName && displayName !== name) {
        await gqlClient(locals.token).request(UPDATE_STATION_MUTATION, {
          id: data.createStation.station.id, name: displayName,
        }).catch(() => {}); // best-effort
      }
      // Pass the rawKey via search param so the detail page can show it once
      redirect(303, `/app/stations/${data.createStation.station.id}?newKey=${encodeURIComponent(data.createStation.rawKey)}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create station' });
    }
  },
};
