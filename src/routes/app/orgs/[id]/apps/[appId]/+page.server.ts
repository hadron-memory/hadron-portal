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
  DELETE_APP_MUTATION,
  APP_NODES_QUERY,
} from '$lib/server/queries';
import type { Organization, App, MemoryNode } from '$lib/types';
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

  // Memory tab nodes — only relevant when the App has memory access via its agents,
  // but the query is cheap and lets the Memory tab render uniformly.
  const nodesData = await client
    .request<{ appNodes: MemoryNode[] }>(APP_NODES_QUERY, { appId: params.appId, limit: 500 })
    .catch(() => ({ appNodes: [] as MemoryNode[] }));

  // 008-agent-installation: an App has at most one Agent (App.agent_id).
  // "Available" = any org agent when none is linked yet; empty otherwise.
  const availableAgents = appData.app.agentId
    ? []
    : (orgData.organization.agents ?? []);
  return {
    app: appData.app,
    org: orgData.organization,
    availableAgents,
    appNodes: nodesData.appNodes,
  };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const urn = String(fd.get('urn') ?? '').trim() || undefined;
    const appType = String(fd.get('appType') ?? '').trim() || undefined;
    const role = String(fd.get('role') ?? '').trim() || undefined;
    const description = fd.has('description')
      ? (String(fd.get('description') ?? '').trim() || null)
      : undefined;
    const systemPrompt = fd.has('systemPrompt')
      ? (String(fd.get('systemPrompt') ?? '').trim() || null)
      : undefined;
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
        urn,
        appType,
        role,
        description,
        systemPrompt,
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
    const trainingMode = fd.get('trainingMode') === 'true';
    if (!agentId) return fail(400, { error: 'Missing agent' });
    try {
      // 008-agent-installation: addAgentToApp is now a setter on
      // App.agent_id; the legacy `role` arg is gone (system memory is
      // universally read-only from any App context).
      await gqlClient(locals.token).request(ADD_AGENT_TO_APP_MUTATION, {
        appId: params.appId,
        agentId,
        trainingMode,
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

  updateAgentTools: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentTools = fd.getAll('agentTools').map(String);
    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        id: params.appId,
        agentTools,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update agent tools') });
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
    // Accept either `id` (legacy form name) or `keyId` to keep template flexibility.
    const id = String(fd.get('id') ?? fd.get('keyId') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to revoke key') });
    }
  },

  deleteApp: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(DELETE_APP_MUTATION, { id: params.appId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to delete app') });
    }
  },
};
