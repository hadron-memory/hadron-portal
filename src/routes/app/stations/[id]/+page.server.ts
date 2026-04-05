import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  MY_STATIONS_QUERY,
  REVOKE_STATION_MUTATION,
  REVOKE_STATION_KEY_MUTATION,
  SUBSCRIBE_STATION_TO_AGENT_MUTATION,
  UNSUBSCRIBE_STATION_FROM_AGENT_MUTATION,
  UPDATE_STATION_MUTATION,
  MY_ORGANIZATIONS_QUERY,
  STATION_NODES_QUERY,
  STATION_KEYS_QUERY,
} from '$lib/server/queries';
import type { Station, StationKey, Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [stationsData, orgsData] = await Promise.all([
    client.request<{ myStations: Station[] }>(MY_STATIONS_QUERY)
      .catch(() => ({ myStations: [] as Station[] })),
    client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
  ]);

  const station = stationsData.myStations.find((c) => c.id === params.id);
  if (!station) throw error(404, 'Station not found');

  // Load station nodes and keys in parallel
  const [nodesData, keysData] = await Promise.all([
    client.request<{ stationNodes: MemoryNode[] }>(
      STATION_NODES_QUERY, { stationId: params.id, limit: 500 },
    ).catch(() => ({ stationNodes: [] as MemoryNode[] })),
    client.request<{ stationKeys: StationKey[] }>(
      STATION_KEYS_QUERY, { stationId: params.id },
    ).catch(() => ({ stationKeys: [] as StationKey[] })),
  ]);

  return { station, orgs: orgsData.myOrganizations, stationNodes: nodesData.stationNodes, stationKeys: keysData.stationKeys };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const urn = String(fd.get('urn') ?? '').trim() || undefined;
    const stationType = String(fd.get('stationType') ?? '').trim() || undefined;
    const description = String(fd.get('description') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPDATE_STATION_MUTATION, { id: params.id, name, urn, stationType, description });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update station' });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const fd = await request.formData();
    const keyId = String(fd.get('keyId') ?? '');
    if (!keyId) return fail(400, { error: 'keyId is required' });
    try {
      await gqlClient(locals.token).request(REVOKE_STATION_KEY_MUTATION, { keyId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to revoke key' });
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
