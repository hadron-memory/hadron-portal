import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  MY_APPS_QUERY,
  DELETE_APP_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  ADD_AGENT_TO_APP_MUTATION,
  REMOVE_AGENT_FROM_APP_MUTATION,
  UPDATE_APP_MUTATION,
  MY_ORGANIZATIONS_QUERY,
  APP_NODES_QUERY,
  APP_KEYS_QUERY,
} from '$lib/server/queries';
import type { App, AppKey, Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [appsData, orgsData] = await Promise.all([
    client.request<{ myApps: App[] }>(MY_APPS_QUERY)
      .catch(() => ({ myApps: [] as App[] })),
    client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
  ]);

  const app = appsData.myApps.find((c) => c.id === params.id);
  if (!app) throw error(404, 'App not found');

  const [nodesData, keysData] = await Promise.all([
    client.request<{ appNodes: MemoryNode[] }>(
      APP_NODES_QUERY, { appId: params.id, limit: 500 },
    ).catch(() => ({ appNodes: [] as MemoryNode[] })),
    client.request<{ appKeys: AppKey[] }>(
      APP_KEYS_QUERY, { appId: params.id },
    ).catch(() => ({ appKeys: [] as AppKey[] })),
  ]);

  return { app, orgs: orgsData.myOrganizations, appNodes: nodesData.appNodes, appKeys: keysData.appKeys };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const urn = String(fd.get('urn') ?? '').trim() || undefined;
    const appType = String(fd.get('appType') ?? '').trim() || undefined;
    const description = String(fd.get('description') ?? '').trim() || null;
    const systemPrompt = String(fd.get('systemPrompt') ?? '').trim() || null;
    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, { id: params.id, name, urn, appType, description, systemPrompt });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update app' });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const fd = await request.formData();
    const keyId = String(fd.get('keyId') ?? '');
    if (!keyId) return fail(400, { error: 'keyId is required' });
    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { keyId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to revoke key' });
    }
  },

  revoke: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(DELETE_APP_MUTATION, { id: params.id });
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
      await gqlClient(locals.token).request(ADD_AGENT_TO_APP_MUTATION, {
        appId: params.id, agentId, subscriptionType, trainingMode,
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to subscribe' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '');
    try {
      await gqlClient(locals.token).request(REMOVE_AGENT_FROM_APP_MUTATION, { appId: params.id, agentId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to unsubscribe' });
    }
  },

  updateAgentTools: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentTools = fd.getAll('agentTools').map(String);
    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, { id: params.id, agentTools });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update agent tools' });
    }
  },
};
