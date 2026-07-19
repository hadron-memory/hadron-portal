import { fail, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
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
  AI_SERVICE_CONFIGS_QUERY,
  RESOLVE_AI_SERVICE_CONFIGS_QUERY,
} from '$lib/server/queries';
import type { Organization, App, MemoryNode, AiServiceConfig } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { addAgentSchema, appSettingsSchema, createAppKeySchema } from './schema';

type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;

const addAgentFormAdapter = zod4(addAgentSchema);
const appSettingsFormAdapter = zod4(appSettingsSchema);
const createAppKeyFormAdapter = zod4(createAppKeySchema);

function slugOfUrn(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [appData, orgData, configsData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { id: params.appId })
      .catch((e) => {
        // graphql-request throws on ANY GraphQL error even when usable data is
        // present. A non-critical NULLABLE field erroring (e.g. installedAgentUrn,
        // whose composeInstalledAgentUrn throws on a malformed app/agent urn)
        // must not 404 the whole page — salvage the app from the partial
        // response so it stays viewable/editable. A genuinely missing app (no
        // data) still falls through to the 404 below. Only a GraphQL error
        // carries `response`; rethrow transport/network errors so they surface
        // as a 500, not a misleading 404.
        if (e && typeof e === 'object' && 'response' in e) {
          const partial = (e as { response?: { data?: { app?: App | null } } }).response?.data;
          return { app: partial?.app ?? null };
        }
        throw e;
      }),
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => ({ organization: null })),
    // 036: APP-owned named configs. org-ADMIN gated server-side; a non-admin
    // member's call errors (the page hides the manager for them anyway).
    // Coerce to null so a transient failure surfaces as a load error to admins
    // instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'APP', ownerId: params.appId,
    }).catch(() => null),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  if (!orgData.organization) throw error(404, 'Organization not found');

  // Memory tab nodes — only relevant when the App has memory access via its agents,
  // but the query is cheap and lets the Memory tab render uniformly.
  // 036: in parallel, the configs RESOLVABLE for the App's chat context
  // (App→Agent→Org→Host, masked) — powers the chat tab's config picker +
  // LLM-readiness gate. App-membership gated; coerce errors to null (unknown
  // ⇒ the page treats readiness as "don't block"). Only meaningful with an
  // agent linked.
  const [nodesData, chatConfigs] = await Promise.all([
    client
      .request<{ appNodes: MemoryNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 })
      .catch(() => ({ appNodes: [] as MemoryNode[] })),
    appData.app.agentId
      ? client
          .request<{ resolveAiServiceConfigs: AiServiceConfig[] }>(RESOLVE_AI_SERVICE_CONFIGS_QUERY, {
            appRef: params.appId,
            agentRef: appData.app.agentId,
          })
          .then((r) => r.resolveAiServiceConfigs)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

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
    chatConfigs,
    appConfigs: configsData ?? [],
    configsError: configsData === null,
    currentUserId: locals.user?.id ?? null,
    appSettingsForm: await superValidate<AppSettingsForm>(
      {
        name: appData.app.name,
        urn: slugOfUrn(appData.app.urn),
        appType: appData.app.appType,
        role: appData.app.role,
        description: appData.app.description ?? '',
        systemPrompt: appData.app.systemPrompt ?? '',
        createUserPermission: appData.app.createUserPermission,
        identifyUserMethod: appData.app.identifyUserMethod,
        sessionTimeoutSeconds: String(appData.app.sessionTimeoutSeconds),
        anonymousTtlDays: String(appData.app.anonymousTtlDays),
      },
      appSettingsFormAdapter,
      { errors: false },
    ),
    addAgentForm: await superValidate<AddAgentForm>(
      { agentId: '' },
      addAgentFormAdapter,
      { errors: false },
    ),
    createKeyForm: await superValidate<CreateAppKeyForm>(
      { label: '' },
      createAppKeyFormAdapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const form = await superValidate<AppSettingsForm>(
      await request.formData(),
      appSettingsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        id: params.appId,
        name: form.data.name,
        urn: form.data.urn,
        appType: form.data.appType,
        role: form.data.role,
        description: form.data.description || null,
        systemPrompt: form.data.systemPrompt || null,
        createUserPermission: form.data.createUserPermission,
        identifyUserMethod: form.data.identifyUserMethod,
        sessionTimeoutSeconds: Number(form.data.sessionTimeoutSeconds),
        anonymousTtlDays: Number(form.data.anonymousTtlDays),
      });
      return message(form, { type: 'success', text: t('app.settings.saved', 'Saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update app') },
        { status: 500 },
      );
    }
  },

  addAgent: async ({ request, params, locals }) => {
    const form = await superValidate<AddAgentForm>(
      await request.formData(),
      addAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    // 008-agent-installation: addAgentToApp is now a setter on
    // App.agent_id; the legacy `role` arg is gone (system memory is
    // universally read-only from any App context). `trainingMode` is
    // forwarded only when the form submits it explicitly so the server
    // default applies otherwise.
    const variables: Record<string, unknown> = { appId: params.appId, agentId: form.data.agentId };
    if (typeof form.data.trainingMode === 'string') variables.trainingMode = form.data.trainingMode === 'true';
    try {
      await gqlClient(locals.token).request(ADD_AGENT_TO_APP_MUTATION, variables);
      return message(form, { type: 'success', text: t('app.agent.linked', 'Agent linked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to add agent') },
        { status: 500 },
      );
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
    const form = await superValidate<CreateAppKeyForm>(
      await request.formData(),
      createAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const label = form.data.label || undefined;
    try {
      const result = await gqlClient(locals.token).request<{
        createAppKey: { key: { id: string }; rawKey: string };
      }>(CREATE_APP_KEY_MUTATION, { appId: params.appId, label });
      return {
        form,
        rawKey: result.createAppKey.rawKey,
        keyId: result.createAppKey.key.id,
      };
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to create key') },
        { status: 500 },
      );
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
