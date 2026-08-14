import { fail, error, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import {
  ORGANIZATION_QUERY,
  APP_QUERY,
  MY_AGENTS_QUERY,
  PUBLIC_AGENTS_QUERY,
  UPDATE_APP_MUTATION,
  ADD_AGENT_TO_APP_MUTATION,
  REMOVE_AGENT_FROM_APP_MUTATION,
  CREATE_APP_KEY_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  APP_NODES_QUERY,
  AI_SERVICE_CONFIGS_QUERY,
  RESOLVE_AI_SERVICE_CONFIGS_QUERY,
  WORKERS_QUERY,
  CAST_WORKER_MUTATION,
  RETIRE_WORKER_MUTATION,
} from '$lib/server/queries';
import type { Organization, App, MemoryNode, AiServiceConfig, Worker } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  addAgentSchema,
  appSettingsSchema,
  castWorkerSchema,
  createAppKeySchema,
  deleteAppSchema,
  removeAppAgentSchema,
  retireWorkerSchema,
  revokeAppKeySchema,
  updateAppAgentToolsSchema,
} from './schema';

type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
type CastWorkerForm = Infer<typeof castWorkerSchema, 'zod4'>;
type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;
type DeleteAppForm = Infer<typeof deleteAppSchema, 'zod4'>;
type RemoveAppAgentForm = Infer<typeof removeAppAgentSchema, 'zod4'>;
type RetireWorkerForm = Infer<typeof retireWorkerSchema, 'zod4'>;
type RevokeAppKeyForm = Infer<typeof revokeAppKeySchema, 'zod4'>;
type UpdateAppAgentToolsForm = Infer<typeof updateAppAgentToolsSchema, 'zod4'>;

// Route-local, but a `/* GraphQL */` const rather than an inline string so
// `pnpm gql:validate` sees it — an inline document is invisible to the gate
// (#690 review), which is how this one kept `ref: $id` after the sweep.
const APP_ORG_QUERY = /* GraphQL */ `
  query AppOrg($ref: ID!) {
    app(ref: $ref) {
      organizationId
    }
  }
`;

const addAgentFormAdapter = zod4(addAgentSchema);
const appSettingsFormAdapter = zod4(appSettingsSchema);
const castWorkerFormAdapter = zod4(castWorkerSchema);
const createAppKeyFormAdapter = zod4(createAppKeySchema);
const deleteAppFormAdapter = zod4(deleteAppSchema);
const removeAppAgentFormAdapter = zod4(removeAppAgentSchema);
const retireWorkerFormAdapter = zod4(retireWorkerSchema);
const revokeAppKeyFormAdapter = zod4(revokeAppKeySchema);
const updateAppAgentToolsFormAdapter = zod4(updateAppAgentToolsSchema);

/**
 * castWorker's typed refusals (#974), mapped to copy that says what to DO.
 * The raw server message names internals ("no installed agent matches role
 * X"), and the codes are a documented contract, so branching on the code is
 * both stabler and more actionable than echoing the message.
 */
const CAST_WORKER_ERRORS: Record<string, () => string> = {
  WORKER_NAME_TAKEN: () => t(
    'app.staff.error.name-taken',
    'That name is already taken in this App. Worker names are reserved permanently, including for retired workers — pick another.',
  ),
  WORKER_AGENT_NOT_INSTALLED: () => t(
    'app.staff.error.agent-not-installed',
    'That agent is not installed in this App. Install it first, then cast it.',
  ),
  WORKER_AGENT_NOT_FOUND: () => t(
    'app.staff.error.agent-not-found',
    'No installed agent matches that role. Pick an agent explicitly.',
  ),
  WORKER_AGENT_AMBIGUOUS: () => t(
    'app.staff.error.agent-ambiguous',
    'Several installed agents match that role. Pick an agent explicitly.',
  ),
  WORKER_REGISTER_EXHAUSTED: () => t(
    'app.staff.error.register-exhausted',
    'Every name in this role’s cast list is taken. Enter a name explicitly.',
  ),
  APP_UNINSTALLED: () => t(
    'app.staff.error.app-uninstalled',
    'This App has been uninstalled, so nothing can be cast into it.',
  ),
};

/**
 * The `extensions.code` of a graphql-request ClientError, when it carries one.
 *
 * Returns null for a transport-level failure (no GraphQL errors payload) and
 * for any code that isn't a string, so callers fall through to the server's own
 * message rather than mislabelling an outage as a user mistake
 * (review:clienterror-map-known-codes-only).
 */
function gqlErrorCode(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ extensions?: { code?: unknown } }> } })
    ?.response?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const code = errors[0]?.extensions?.code;
  return typeof code === 'string' ? code : null;
}

function slugOfUrn(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  // #648: canonical org-optional App detail. No requireNonConsumer — this
  // resolves BOTH org-owned apps (member-gated) and user-owned (org-less) apps
  // (owner-gated) through one owner-accessible path, exactly like /app/agents/[id]
  // (#641). The server's app(ref:) gate IS the auth; a non-owner/non-member gets
  // null → 404 (no over-exposure).
  const client = gqlClient(locals.token);
  const [appData, configsData] = await Promise.all([
    client.request<{ app: App | null }>(APP_QUERY, { ref: params.appId })
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
    // 036: APP-owned named configs. org-ADMIN gated server-side; a non-admin
    // member's call errors (the page hides the manager for them anyway).
    // Coerce to null so a transient failure surfaces as a load error to admins
    // instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'APP', ownerId: params.appId,
    }).catch(() => null),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  const app = appData.app;

  // Org chrome only for an org-owned app; a user-owned (org-less) app (spec 047)
  // has none. availableAgents (installable when no Agent is linked yet) = the
  // org's agents for an org app, or the caller's own personal agents ∪ PUBLIC
  // agents for an org-less app — mirroring the server install gate (createApp: a
  // personal App may install a PUBLIC or the caller's OWN personal agent).
  let org: Organization | null = null;
  let availableAgents: Array<{ id: string; name: string; urn: string }> = [];
  if (app.organizationId) {
    const orgData = await client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { ref: app.organizationId })
      .catch(() => ({ organization: null }));
    if (!orgData.organization) throw error(404, 'Organization not found');
    org = orgData.organization;
    availableAgents = app.agentId ? [] : (org.agents ?? []);
  } else if (!app.agentId) {
    const [mine, publicAgents] = await Promise.all([
      // #782: MY_AGENTS_QUERY is scoped server-side (filter.ownedByMe), so it's
      // already the caller's own org-less agents — no client-side filter needed.
      fetchAllItems<{ id: string; name: string; urn: string }>(
        client, MY_AGENTS_QUERY, 'agents',
      ).catch(() => []),
      fetchAllItems<{ id: string; name: string; urn: string }>(
        client, PUBLIC_AGENTS_QUERY, 'publicAgents',
      ).catch(() => []),
    ]);
    // Dedupe by id — a public agent could also be the caller's own.
    const seen = new Set<string>();
    availableAgents = [...mine, ...publicAgents].filter((a) =>
      seen.has(a.id) ? false : (seen.add(a.id), true),
    );
  }

  // Memory tab nodes — only relevant when the App has memory access via its agents,
  // but the query is cheap and lets the Memory tab render uniformly.
  // 036: in parallel, the configs RESOLVABLE for the App's chat context
  // (App→Agent→Org→Host, masked) — powers the chat tab's config picker +
  // LLM-readiness gate. App-membership gated; coerce errors to null (unknown
  // ⇒ the page treats readiness as "don't block"). Only meaningful with an
  // agent linked.
  const [nodesData, chatConfigs, staff] = await Promise.all([
    client
      .request<{ appNodes: MemoryNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 })
      .catch(() => ({ appNodes: [] as MemoryNode[] })),
    app.agentId
      ? client
          .request<{ resolveAiServiceConfigs: AiServiceConfig[] }>(RESOLVE_AI_SERVICE_CONFIGS_QUERY, {
            appRef: params.appId,
            agentRef: app.agentId,
          })
          .then((r) => r.resolveAiServiceConfigs)
          .catch(() => null)
      : Promise.resolve(null),
    // #974: the App's STAFF — its Workers. includeRetired because a retired
    // worker still holds its name forever, so hiding it turns the eventual
    // WORKER_NAME_TAKEN into a mystery. Coerced to null (never []) on failure:
    // "couldn't load the staff" and "this App has no staff yet" are different
    // statements and the empty state must not tell the second lie
    // (review:no-silent-loader-catch).
    fetchAllItems<Worker>(client, WORKERS_QUERY, 'workers', {
      appRef: params.appId,
      includeRetired: true,
    }).catch((e) => {
      console.warn(`[app-staff] workers fetch failed for ${params.appId}:`, e);
      return null;
    }),
  ]);
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm] = await Promise.all([
    superValidate<AppSettingsForm>(
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
    superValidate<AddAgentForm>(
      { agentId: '' },
      addAgentFormAdapter,
      { errors: false },
    ),
    superValidate<CreateAppKeyForm>(
      { label: '' },
      createAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<RemoveAppAgentForm>(
      { agentId: '' },
      removeAppAgentFormAdapter,
      { errors: false },
    ),
    superValidate<UpdateAppAgentToolsForm>(
      { agentTools: appData.app.agentTools ?? [] },
      updateAppAgentToolsFormAdapter,
      { errors: false },
    ),
    superValidate<RevokeAppKeyForm>(
      { keyId: '' },
      revokeAppKeyFormAdapter,
      { errors: false },
    ),
    superValidate<DeleteAppForm>(
      {},
      deleteAppFormAdapter,
      { errors: false },
    ),
    superValidate<CastWorkerForm>(
      { agentId: '' },
      castWorkerFormAdapter,
      { errors: false },
    ),
    superValidate<RetireWorkerForm>(
      { workerId: '' },
      retireWorkerFormAdapter,
      { errors: false },
    ),
  ]);
  return {
    app,
    org,
    availableAgents,
    appNodes: nodesData.appNodes,
    chatConfigs,
    appConfigs: configsData ?? [],
    configsError: configsData === null,
    // #974: the App's staff. null = the fetch failed (distinct from []).
    staff,
    staffError: staff === null,
    currentUserId: locals.user?.id ?? null,
    appSettingsForm,
    addAgentForm,
    createKeyForm,
    removeAgentForm,
    updateAgentToolsForm,
    revokeKeyForm,
    deleteAppForm,
    castWorkerForm,
    retireWorkerForm,
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
        ref: params.appId,
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
    const variables: Record<string, unknown> = { appRef: params.appId, agentRef: form.data.agentId };
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
    const form = await superValidate<RemoveAppAgentForm>(
      await request.formData(),
      removeAppAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_AGENT_FROM_APP_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
      });
      return message(form, { type: 'success', text: t('app.agent.unlinked', 'Agent unlinked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to remove agent') },
        { status: 500 },
      );
    }
  },

  updateAgentTools: async ({ request, params, locals }) => {
    const form = await superValidate<UpdateAppAgentToolsForm>(
      await request.formData(),
      updateAppAgentToolsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_APP_MUTATION, {
        ref: params.appId,
        agentTools: form.data.agentTools,
      });
      return message(form, { type: 'success', text: t('app.agent-tools.saved', 'Client tools saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update agent tools') },
        { status: 500 },
      );
    }
  },

  // ── Casting (#974) ──────────────────────────────────────────────────────
  //
  // castWorker CASTS an agent that is ALREADY INSTALLED in this App; it mints
  // nothing. Name and role are optional: an omitted name walks the Team Agent's
  // cast-list register, an omitted role inherits the agent's personaRole. Both
  // must therefore be sent as UNDEFINED when blank — '' would be an explicit
  // (and invalid) name, which is a different request entirely.
  castWorker: async ({ request, params, locals }) => {
    const form = await superValidate<CastWorkerForm>(
      await request.formData(),
      castWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CAST_WORKER_MUTATION, {
        appRef: params.appId,
        agentRef: form.data.agentId,
        name: form.data.name || undefined,
        role: form.data.role || undefined,
        promptOverride: form.data.promptOverride || undefined,
      });
      return message(form, {
        type: 'success',
        text: t('app.staff.cast.success', 'Worker cast.'),
      });
    } catch (e: unknown) {
      // Known refusals get copy that says what to do next; anything else —
      // including a transport failure with no GraphQL payload — falls through
      // to the server's own message rather than being relabelled as a user
      // mistake (review:clienterror-map-known-codes-only).
      const known = CAST_WORKER_ERRORS[gqlErrorCode(e) ?? ''];
      return message(
        form,
        {
          type: 'error',
          text: known ? known() : extractGqlError(e, t('app.staff.cast.error', 'Failed to cast the worker.')),
        },
        { status: 500 },
      );
    }
  },

  // Retiring ends the casting but reserves the name FOREVER — it is not a
  // delete, and the row stays visible in the staff list.
  retireWorker: async ({ request, locals }) => {
    const form = await superValidate<RetireWorkerForm>(
      await request.formData(),
      retireWorkerFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(RETIRE_WORKER_MUTATION, {
        workerRef: form.data.workerId,
      });
      return message(form, {
        type: 'success',
        text: t('app.staff.retire.success', 'Worker retired. Its name stays reserved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: extractGqlError(e, t('app.staff.retire.error', 'Failed to retire the worker.')),
        },
        { status: 500 },
      );
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
      }>(CREATE_APP_KEY_MUTATION, { appRef: params.appId, label });
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
    const form = await superValidate<RevokeAppKeyForm>(
      await request.formData(),
      revokeAppKeyFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REVOKE_APP_KEY_MUTATION, { id: form.data.keyId });
      return message(form, { type: 'success', text: t('app.key.revoked', 'Key revoked.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to revoke key') },
        { status: 500 },
      );
    }
  },

  deleteApp: async ({ request, params, locals }) => {
    const form = await superValidate<DeleteAppForm>(
      await request.formData(),
      deleteAppFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    // #648: where to land after delete depends on ownership — an org app returns
    // to its org apps grid, a user-owned (org-less) app to the personal "My apps"
    // list. Resolve the org BEFORE deleting (the row is gone afterwards); a
    // lookup failure falls back to the personal list.
    let orgId: string | null = null;
    try {
      const res = await client.request<{ app: { organizationId: string | null } | null }>(
        APP_ORG_QUERY,
        { ref: params.appId },
      );
      orgId = res.app?.organizationId ?? null;
    } catch {
      // Non-fatal — the redirect target degrades to the personal list.
    }

    try {
      await client.request(DELETE_APP_MUTATION, { ref: params.appId });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete app') },
        { status: 500 },
      );
    }
    redirect(303, orgId ? `/app/orgs/${orgId}/apps` : '/app/apps');
  },
};
