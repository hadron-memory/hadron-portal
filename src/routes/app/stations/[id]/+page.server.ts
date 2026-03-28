import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  MY_STATIONS_QUERY,
  REGENERATE_API_KEY_MUTATION,
  REVOKE_STATION_MUTATION,
  SUBSCRIBE_STATION_TO_AGENT_MUTATION,
  UNSUBSCRIBE_STATION_FROM_AGENT_MUTATION,
  UPDATE_STATION_MUTATION,
  MY_ORGANIZATIONS_QUERY,
} from '$lib/server/queries';
import type { Station, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  await requireNonConsumer(parent);
  const [stationsData, orgsData] = await Promise.all([
    gqlClient(locals.token).request<{ myStations: Station[] }>(MY_STATIONS_QUERY)
      .catch(() => ({ myStations: [] as Station[] })),
    gqlClient(locals.token).request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
  ]);

  const station = stationsData.myStations.find((c) => c.id === params.id);
  if (!station) throw error(404, 'Station not found');

  const newKey = url.searchParams.get('newKey') ?? null;
  return { station, newKey, orgs: orgsData.myOrganizations };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const stationType = String(fd.get('stationType') ?? '').trim() || undefined;
    const description = String(fd.get('description') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPDATE_STATION_MUTATION, { id: params.id, name, stationType, description });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update station' });
    }
  },

  regenerate: async ({ params, locals }) => {
    try {
      const result = await gqlClient(locals.token).request<{ regenerateApiKey: { rawKey: string } }>(
        REGENERATE_API_KEY_MUTATION, { id: params.id },
      );
      redirect(303, `/app/stations/${params.id}?newKey=${encodeURIComponent(result.regenerateApiKey.rawKey)}`);
    } catch (e: unknown) {
      if ((e as { status?: number }).status === 303) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to regenerate key' });
    }
  },

  revoke: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(REVOKE_STATION_MUTATION, { id: params.id });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to revoke' });
    }
  },

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '');
    const subscriptionType = String(fd.get('subscriptionType') ?? 'READ_ONLY');
    const trainingMode = fd.get('trainingMode') === 'true';
    try {
      await gqlClient(locals.token).request(SUBSCRIBE_STATION_TO_AGENT_MUTATION, {
        stationId: params.id, agentId, subscriptionType, trainingMode,
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to subscribe' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '');
    try {
      await gqlClient(locals.token).request(UNSUBSCRIBE_STATION_FROM_AGENT_MUTATION, { stationId: params.id, agentId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to unsubscribe' });
    }
  },

  updateAgentTools: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentTools = fd.getAll('agentTools').map(String);
    try {
      await gqlClient(locals.token).request(UPDATE_STATION_MUTATION, { id: params.id, agentTools });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update agent tools' });
    }
  },
};
