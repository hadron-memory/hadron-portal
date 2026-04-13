import { fail, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  APP_QUERY,
  UPDATE_APP_MUTATION,
  ADD_AGENT_TO_APP_MUTATION,
  REMOVE_AGENT_FROM_APP_MUTATION,
  CREATE_APP_KEY_MUTATION,
  REVOKE_APP_KEY_MUTATION,
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
  const [appData, orgData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { id: params.appId })
      .catch(() => ({ app: null })),
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => ({ organization: null })),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  if (!orgData.organization) throw error(404, 'Organization not found');
  const availableAgents = (orgData.organization.agents ?? []).filter(
    (a) => !appData.app!.agents.some((aa) => aa.id === a.id),
  );
  return { app: appData.app, org: orgData.organization, availableAgents };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const createUserPermission = String(fd.get('createUserPermission') ?? '').trim() || undefined;
    const identifyUserMethod = String(fd.get('identifyUserMethod') ?? '').trim() || undefined;
    const sessionTimeoutSeconds = fd.get('sessionTimeoutSeconds')
      ? Number(fd.get('sessionTimeoutSeconds'))
      : undefined;
    const anonymousTtlDays = fd.get('anonymousTtlDays')
      ? Number(fd.get('anonymousTtlDays'))
      : undefined;
    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        id: params.appId,
        name,
        createUserPermission,
        identifyUserMethod,
        sessionTimeoutSeconds,
        anonymousTtlDays,
      });
      return { updated: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update app') });
    }
  },

  addAgent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '');
    if (!agentId) return fail(400, { error: 'Missing agent' });
    try {
      await gqlClient(locals.token).request(ADD_AGENT_TO_APP_MUTATION, {
        appId: params.appId,
        agentId,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to add agent') });
    }
  },

  removeAgent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '');
    if (!agentId) return fail(400, { error: 'Missing agent' });
    try {
      await gqlClient(locals.token).request(REMOVE_AGENT_FROM_APP_MUTATION, {
        appId: params.appId,
        agentId,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove agent') });
    }
  },

  createKey: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const label = String(fd.get('label') ?? '').trim() || undefined;
    try {
      const result = await gqlClient(locals.token).request<{
        createAppKey: { key: { id: string }; rawKey: string };
      }>(CREATE_APP_KEY_MUTATION, { appId: params.appId, label });
      return {
        rawKey: result.createAppKey.rawKey,
        keyId: result.createAppKey.key.id,
      };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to create key') });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to revoke key') });
    }
  },
};
