import { installMarksOf, type AppAgentInstall } from '$lib/app-install-marks';
import { memberRolesFormId } from './member-roles-form-id';
import { loadAgentExtensions, loadSystemMemoryIdentity } from '$lib/server/agent-profile';
import { agentBaseSchema, agentIndexRefsSchema } from './inheritance-schema';
import { loadInheritanceManagement, loadBaseCandidates, baseVariables, indexVariables, SET_AGENT_BASE_MUTATION, SET_AGENT_INDEX_REFS_MUTATION } from '$lib/server/agent-inheritance-write';
import { loadAgentInheritance } from '$lib/server/agent-inheritance';
import {
  CREATE_AGENT_TICKER_TEMPLATE_MUTATION,
  DELETE_AGENT_TICKER_TEMPLATE_MUTATION,
  UPDATE_AGENT_TICKER_TEMPLATE_MUTATION,
  classifyTemplateError,
  loadAgentTickerTemplates,
} from '$lib/server/agent-ticker-templates';
import { formValues, impersonationRefusal, writeFailure } from '$lib/server/agent-task-writes';
import { buildTemplateCreateInput, buildTemplateDelete, buildTemplateUpdate } from '$lib/tickers/template-write';
import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { compileRefusalStatus, compileRefusalText } from '$lib/boot-compile';
import { approvalRefusalStatus, approveRefusalText } from '$lib/node-approval';
import { BOOT_SOURCE_LOC, readBootSource, readCompiled, readServedRevision } from '$lib/server/boot-source';
import { pointerAction, readPointer, selfCanManage } from '$lib/server/boot-prompt-pointer';
import { drainFindNodes, fetchAllItems } from '$lib/server/paginate';
import { fetchOwnedMemoriesLite } from '$lib/server/personal-memories';
import type { OwnedMemoryLite } from '$lib/server/personal-memories';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions, gqlErrorBody } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import { grantedAgents, type InstallableAgent, type OrgAgentPool } from '$lib/server/installable-agents';
import { withTimeout, OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import {
  AGENT_QUERY,
  ORGANIZATIONS_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  GRAPH_NODES_QUERY,
  AGENT_APPS_QUERY,
  AGENT_OWNED_APPS_QUERY,
  UPDATE_AGENT_MUTATION,
  COMPILE_AGENT_BOOT_PROMPT_MUTATION,
  APPROVE_NODE_MUTATION,
  DELETE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
  UPDATE_AGENT_MEMORY_ROLE_MUTATION,
  REMOVE_MEMORY_FROM_AGENT_MUTATION,
  AI_SERVICE_CONFIGS_QUERY,
  AGENT_REGISTER_DEFAULTS_QUERY,
  AGENT_RESET_CONTEXT_QUERY,
  UPDATE_AGENT_RESET_CONTEXT_MUTATION,
  AGENT_BOOT_POINTER_QUERY,
  AGENT_BOOT_START_QUERY,
  CREATE_NODE_MUTATION,
  SET_AGENT_BOOT_PROMPT_MUTATION,
  UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION,
  UPDATE_AGENT_MEMBER_ROLES_MUTATION,
  APP_ORG_AGENT_GRANTS_QUERY,
  PUBLISH_AGENT_IMPORT_MUTATION,
} from '$lib/server/queries';
import type { Agent, Organization, Memory, MemoryNode, AiServiceConfig } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  bootStartSchema,
  bootCompileSchema,
  bootApproveSchema,
  addAgentMemorySchema,
  agentRegisterDefaultsSchema,
  agentResetContextSchema,
  agentSettingsSchema,
  deleteAgentSchema,
  removeAgentMemorySchema,
  updateAgentMemoryRoleSchema,
  updateAgentMemberRolesSchema,
} from './schema';

// Route-local, but a `/* GraphQL */` const rather than an inline string so
// `pnpm gql:validate` sees it — an inline document is invisible to the gate
// (#690 review), which is how this one kept `ref: $id` after the sweep.
const AGENT_ORG_QUERY = /* GraphQL */ `
  query AgentOrg($ref: ID!) {
    agent(ref: $ref) {
      organizationId
    }
  }
`;

const agentSettingsFormAdapter = zod4(agentSettingsSchema);
const agentRegisterDefaultsFormAdapter = zod4(agentRegisterDefaultsSchema);
const agentResetContextFormAdapter = zod4(agentResetContextSchema);
const updateAgentMemberRolesFormAdapter = zod4(updateAgentMemberRolesSchema);
const addAgentMemoryFormAdapter = zod4(addAgentMemorySchema);
const updateAgentMemoryRoleFormAdapter = zod4(updateAgentMemoryRoleSchema);
const removeAgentMemoryFormAdapter = zod4(removeAgentMemorySchema);
const deleteAgentFormAdapter = zod4(deleteAgentSchema);

type AddAgentMemoryForm = Infer<typeof addAgentMemorySchema, 'zod4'>;
type DeleteAgentForm = Infer<typeof deleteAgentSchema, 'zod4'>;

// #1275: ok = the server's value; absent = this server has no such field;
// failed = the read failed for another reason.
type ResetContextState = { kind: 'ok'; value: boolean } | { kind: 'absent' } | { kind: 'failed' };

function urnSlug(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);

  // #636: resolve the agent through the owner-accessible find-one so BOTH org
  // agents (membership-gated) and user-owned org-less agents (owner-gated) are
  // reachable. This replaces the old organizations()-scan, which only found org
  // agents and 404'd a personal agent. No requireNonConsumer: the server's
  // agent(ref:) gate IS the auth — a consumer can own a personal agent, and a
  // non-member/non-owner gets null → 404 (no over-exposure). A THROWN error
  // (network/GraphQL) becomes a 500, distinct from a legitimate not-found.
  const agentRes = await client
    .request<{ agent: Agent | null }>(AGENT_QUERY, { ref: params.id })
    .catch((e: unknown) => {
      throw error(500, gqlErrorBody(e, 'Failed to load agent'));
    });
  const agent = agentRes.agent;
  if (!agent) throw error(404, 'Agent not found or no longer available');

  // Org chrome only for an org-owned agent whose org the caller belongs to. A
  // user-owned agent (organizationId null) belongs to no org, and a readable
  // agent of a FOREIGN org (a cross-org PUBLIC agent, #1339) is not in the
  // caller's organizations() list: both render without org chrome (org null, no
  // org name / install / org system-memory picker). Not finding the org is not
  // a reason to refuse an agent the server already returned — agent(ref:) is the
  // gate, the list is only chrome — and the foreign org is never looked up.
  let org: Organization | null = null;
  let orgs: Organization[] = [];
  if (agent.organizationId) {
    orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');
    org = orgs.find((o) => o.id === agent.organizationId) ?? null;
  }

  // 006-asset-upload-redesign FR-013: per-agent asset-upload toggle is
  // gone. The v1 callerApp/assetUploadEnabled lookup is removed; the
  // memory-level acceptsUploads gate lives on the memory settings page.

  // Load nodes from all memories (including system memory) + org system memories
  const memoryIds = (agent.memoryItems ?? []).map((m) => m.memory.id);
  const systemMemoryId = (agent as any).systemMemoryId as string | null;
  // Ensure system memory nodes are loaded even if not in memoryItems
  const allMemoryIds = systemMemoryId && !memoryIds.includes(systemMemoryId)
    ? [...memoryIds, systemMemoryId]
    : memoryIds;
  let agentNodes: MemoryNode[] = [];
  let orgSystemMemories: Memory[] = [];

  type AgentAppLite = {
    id: string;
    name: string;
    urn: string;
    organizationId: string;
    // The install join. A row whose `agent` is null is an install withheld from
    // the caller (#1350); `agents` silently drops it.
    appAgents?: AppAgentInstall[] | null;
    agents?: Array<{
      id: string;
      name: string;
      urn: string;
      description: string | null;
      personaRole: string | null;
    }>;
  };

  // A failed Apps read is not an empty list: the Apps tab says it could not load.
  let installedAppsError = false;
  const appsReadFailed = () => {
    installedAppsError = true;
    return [] as AgentAppLite[];
  };

  const [nodesResult, sysMemResult, configsResult, orgAppsResult, ownedAppsResult, personalMemsResult, registerDefaultsResult, resetContext, inheritance, inheritanceManagement, baseCandidates, bootPointer, canManageAgent] = await Promise.all([
    allMemoryIds.length > 0
      ? drainFindNodes<{ node: MemoryNode }>(
          client, GRAPH_NODES_QUERY, { memoryIds: allMemoryIds },
        ).catch(() => null)
      : Promise.resolve(null),
    // Org system memories feed the system-memory picker — org-only; a user-owned
    // agent has no org, so skip the query.
    org
      ? fetchAllItems<Memory>(client, ORG_SYSTEM_MEMORIES_QUERY, 'memories', { orgId: org.id })
          .catch(() => [] as Memory[])
      : Promise.resolve([] as Memory[]),
    // 036: the AGENT-owned named configs. org-ADMIN gated server-side; a
    // non-admin member's call errors (the page hides the manager for them
    // anyway). Coerce to null so a transient failure surfaces as a load error
    // to admins instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'AGENT', ownerId: agent.id,
    }).catch(() => null),
    // Apps this agent is installed into (member-scoped, all caller orgs),
    // filtered server-side by the AppAgent join (#472).
    // Non-fatal: a failure flags `installedAppsError` instead of reading as none.
    fetchAllItems<AgentAppLite>(client, AGENT_APPS_QUERY, 'apps', { agentId: agent.id }).catch(appsReadFailed),
    // …plus the caller's OWN org-less apps. `apps()` routes on org membership,
    // so a user-owned App is only reachable through filter.ownedByMe (#782) —
    // without this a personal team App showed neither in the Apps tab nor in
    // Bundled agents, though createTeamPersona supports one (#714 review).
    fetchAllItems<AgentAppLite>(client, AGENT_OWNED_APPS_QUERY, 'apps', { agentId: agent.id }).catch(appsReadFailed),
    // #642: the caller's OWN personal memories, offered as "Add memory" options
    // for a personal agent. Gated on `!agent.organizationId && visibility !== 'PUBLIC'`
    // (org-less, not merely org-unknown: #1339), which
    // means the caller OWNS a non-PUBLIC org-less agent: agent(ref:) only returns
    // a non-PUBLIC user-owned agent to its owner (owner-only access), and a PUBLIC
    // agent can't hold owner-only memories anyway (congruence). So this never
    // offers personal memories on someone else's PUBLIC agent, nor on an
    // org-visible agent (review #661). Slim projection; non-fatal.
    !agent.organizationId && agent.visibility !== 'PUBLIC'
      ? fetchOwnedMemoriesLite(locals.token).catch(() => [] as OwnedMemoryLite[])
      : Promise.resolve([] as OwnedMemoryLite[]),
    // #942: the install-row register default. A failure is null, which the
    // Settings tab renders as "could not load", never as the default being off.
    client
      .request<{ agent: { registerDefaults: { mentionOnly: boolean } } | null }>(
        AGENT_REGISTER_DEFAULTS_QUERY, { ref: agent.id },
      )
      .then((r) => r.agent?.registerDefaults ?? null)
      .catch(() => null),
    // #1275: its own read. A server that has not deployed the field refuses the
    // document at validation, which is "absent" (the control is not rendered,
    // and nothing is said); any other failure is "failed", stated, never read
    // as the setting being off.
    client
      .request<{ agent: { resetContextAfterTask: boolean } | null }>(
        AGENT_RESET_CONTEXT_QUERY, { ref: agent.id },
      )
      .then((r): ResetContextState => r.agent ? { kind: 'ok', value: r.agent.resetContextAfterTask } : { kind: 'failed' })
      .catch((e: unknown): ResetContextState =>
        extractGqlErrorCode(e) === 'GRAPHQL_VALIDATION_FAILED' ? { kind: 'absent' } : { kind: 'failed' }),
    loadAgentInheritance(client, agent.id),
    loadInheritanceManagement(client, agent.id, agent.urn, locals.user?.id ?? null, !!locals.impersonation),
    // #1108/#1278: parent-agent candidates include readable active org grants.
    // A failed grants read drops only that pool; a failed primary read is null
    // so the picker shows "could not load", not a fake-empty list.
    loadBaseCandidates(client, locals.token, agent.organizationId, agent.id),
    // portal#1142 S8: the Agent's boot-prompt pointer (its own read, so a
    // failure is not a null pointer), and whether to offer its form.
    readPointer(
      () => client.request<{ agent: { bootPromptRef: string | null; bootPromptTargetDeleted: boolean | null } | null }>(AGENT_BOOT_POINTER_QUERY, { ref: agent.id }),
      (r) => r.agent,
      `agent ${agent.id}`,
    ),
    selfCanManage(client, locals.user?.id, agent.urn),
  ]);

  // An agent can be installed into several apps, and an app can host several
  // agents — match on the AppAgent join (`appAgents`) or the readable roster.
  const agentId = agent.id;
  // The two app lists can overlap for a platform admin, so de-dupe by app id
  // before anything counts or lists them.
  const appsById = new Map<string, AgentAppLite>();
  for (const a of [...(orgAppsResult ?? []), ...(ownedAppsResult ?? [])]) {
    if (!appsById.has(a.id)) appsById.set(a.id, a);
  }
  const appsWithThisAgent = [...appsById.values()]
    .filter((a) =>
      (a.appAgents ?? []).some((r) => r.agent?.id === agentId) ||
      (a.agents ?? []).some((x) => x.id === agentId));
  const installedApps = appsWithThisAgent
    .map((a) => ({ id: a.id, name: a.name, urn: a.urn, orgId: a.organizationId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // #713 "Bundled agents": the agents this one carries with it. Two sources,
  // de-duplicated by agent id (an import that is also co-installed appears once):
  //   1. SIBLINGS co-installed in the same App(s) — a co-install writes no
  //      AgentImport edge, so `imports` is empty for a team App's roster.
  //   2. AgentImport edges — the declarative 008-agent-installation bundling.
  // `via` records which App (or the import edge) put it in the list.
  //
  // Post-#974 these are ROLE-ACTORS (the install roster), not named individuals:
  // who is actually cast in an App is that App's Worker staff, listed on the App
  // page. Hence a Role column and no name-of-a-person column.
  const bundledById = new Map<string, {
    id: string; name: string; urn: string; description: string | null;
    personaRole: string | null; via: string;
  }>();
  // portal#1350: an install the caller cannot read comes back as an `appAgents` row whose
  // `agent` is null (`App.agents` drops it and `App.agentId` is masked, so neither can say so).
  // Such an install means this list may be incomplete: hidden siblings, or a hidden App that
  // installs this Agent. Read across ALL the Apps (deduplicated above), before the link filter.
  // A missing/non-array `appAgents` is unknown, never proof of completeness. Boolean only:
  // no hidden count, name, URN or id reaches the page.
  const bundledMayBeIncomplete = [...appsById.values()].some(
    (a) => !Array.isArray(a.appAgents) || a.appAgents.some((r) => !r || r.agent == null),
  );
  for (const app of appsWithThisAgent) {
    // portal#1684: only the server's DERIVED says so; a withheld answer leaves the App's name.
    const marks = installMarksOf(app.appAgents);
    for (const sibling of app.agents ?? []) {
      if (sibling.id === agentId || bundledById.has(sibling.id)) continue;
      const mark = marks[sibling.id];
      bundledById.set(sibling.id, {
        id: sibling.id,
        name: sibling.name,
        urn: sibling.urn,
        description: sibling.description ?? null,
        personaRole: sibling.personaRole ?? null,
        via: mark?.kind === 'derived'
          ? t('agent.bundled.via.derived', '{app}, derived from {importer}', { app: app.name, importer: mark.importer.name })
          : app.name,
      });
    }
  }
  for (const imp of agent.imports ?? []) {
    const imported = imp.importedAgent;
    if (!imported || imported.id === agentId || bundledById.has(imported.id)) continue;
    bundledById.set(imported.id, {
      id: imported.id,
      name: imported.name,
      urn: imported.urn,
      description: imported.description ?? null,
      personaRole: imported.personaRole ?? null,
      via: imp.required ? 'Import (required)' : 'Import',
    });
  }
  const bundledAgents = [...bundledById.values()].sort((a, b) => a.name.localeCompare(b.name));

  // A failed read (any page) is not an empty memory; the Nodes tab says so.
  const agentNodesError = allMemoryIds.length > 0 && nodesResult === null;

  // #1173: what the Bundled tab can add. ONLY the agents the org subscribes to
  // (active grants, the App page's #1172 read), minus this agent and anything
  // it already imports. Not the org's OWNED agents: publishAgentImport needs an
  // active AgentOrgGrant from the parent's org for the imported agent, and an org
  // cannot grant itself an agent (SELF_AGENT_ORG_GRANT), so every owned agent is
  // refused (browser QA, portal#1189). An import the viewer cannot read (importedAgent null)
  // still counts, by its id, so it is never offered a second time. Asked as a
  // request of its own: a refusal costs the add control, not the page. An
  // org-less agent has no org pool, so it gets none.
  const importedIds = new Set((agent.imports ?? []).map((i) => i.importedAgentId));
  let bundleCandidates: InstallableAgent[] = [];
  let bundleCandidatesError = false;
  if (org) {
    const pool = await withTimeout(
      client
        .request<{ organization: Pick<OrgAgentPool, 'agentOrgGrants'> | null }>(APP_ORG_AGENT_GRANTS_QUERY, { ref: org.id })
        .then((r) => (r.organization ? grantedAgents({ agents: [], agentOrgGrants: r.organization.agentOrgGrants }) : null)),
      OPTIONAL_LIST_TIMEOUT_MS,
      null,
    ).catch(() => null);
    bundleCandidatesError = pool === null;
    bundleCandidates = (pool ?? []).filter((a) => a.id !== agentId && !importedIds.has(a.id));
  }
  // The next free slot; the server owns ordering, this only avoids a clash.
  const nextImportPosition = Math.max(0, ...(agent.imports ?? []).map((i) => i.position)) + 1;

  if (nodesResult) {
    const memoryMap = new Map((agent.memoryItems ?? []).map((m) => [m.memory.id, m.memory]));
    agentNodes = (nodesResult.findNodes?.hits ?? [])
      .map((h) => h.node)
      .filter((n) => allMemoryIds.includes(n.memoryId))
      .map((n) => ({ ...n, memory: memoryMap.get(n.memoryId) ?? null }));
  }
  orgSystemMemories = sysMemResult;
  const [form, registerDefaultsForm, resetContextForm, memberRolesForm, addMemoryForm, updateMemoryRoleForm, removeMemoryForm, deleteForm] = await Promise.all([
    superValidate({
      name: agent.name ?? '',
      urnSlug: urnSlug(agent.urn),
      description: agent.description ?? '',

      visibility: agent.visibility ?? 'ORGANIZATION',
      systemMemoryId: '',
      personaRole: agent.personaRole ?? '',
    }, agentSettingsFormAdapter, { errors: false }),
    superValidate(
      { mentionOnly: registerDefaultsResult?.mentionOnly ?? false },
      agentRegisterDefaultsFormAdapter,
      { errors: false },
    ),
    superValidate(
      { resetContextAfterTask: resetContext.kind === 'ok' ? resetContext.value : false },
      agentResetContextFormAdapter,
      { id: `resetContext:${params.id}`, errors: false },
    ),
    superValidate(
      { roles: agent.installationPolicy?.memberRoles ?? [] },
      updateAgentMemberRolesFormAdapter,
      { errors: false, id: memberRolesFormId(agent.id) },
    ),
    superValidate<AddAgentMemoryForm>(
      { memoryId: '', role: 'read' },
      addAgentMemoryFormAdapter,
      { errors: false, id: 'addMemory' },
    ),
    superValidate(
      { memoryId: '', role: 'read' },
      updateAgentMemoryRoleFormAdapter,
      { errors: false, id: 'updateMemoryRole' },
    ),
    superValidate(
      { memoryId: '' },
      removeAgentMemoryFormAdapter,
      { errors: false },
    ),
    superValidate<DeleteAgentForm>(
      {},
      deleteAgentFormAdapter,
      { errors: false },
    ),
  ]);

  const [baseForm, indexRefsForm] = await Promise.all([
    superValidate({ _kind: 'setAgentBase', operation: 'set', baseRef: '' }, zod4(agentBaseSchema), { id: 'agentBase', errors: false }),
    superValidate({ _kind: 'setAgentIndexRefs', tasksOperation: 'keep', tasksIndexRef: '', processesOperation: 'keep', processesIndexRef: '' }, zod4(agentIndexRefsSchema), { id: 'agentIndexRefs', errors: false }),
  ]);
  const [extendedBy, systemMemoryIdentity, tickerTemplates] = await Promise.all([
    loadAgentExtensions(client, agent.id, url?.searchParams.get('extendedAfter') ?? null),
    loadSystemMemoryIdentity(client, systemMemoryId),
    // portal#1609: its own read, so a failure costs the Ticker templates tab and never the page.
    loadAgentTickerTemplates(client, agent.id),
  ]);
  // portal#1377: after the pointer read, because it decides which editor to offer.
  const bootSource = await readBootSource(client, bootPointer, systemMemoryId);
  return {
    extendedBy, systemMemoryIdentity, tickerTemplates,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    extendedAfter: url?.searchParams.get('extendedAfter') ?? null,
    inheritanceManagement, baseCandidates, baseForm, indexRefsForm,
    inheritance,
    agent,
    org,
    agentNodes,
    agentNodesError,
    installedApps,
    installedAppsError,
    bundledAgents,
    bundleCandidates,
    bundleCandidatesError,
    nextImportPosition,
    bundledMayBeIncomplete,
    allOrgs: orgs,
    orgSystemMemories,
    // Empty for an org agent; the caller's own memories for a user-owned agent (#642).
    personalMemories: personalMemsResult,
    agentConfigs: configsResult ?? [],
    configsError: configsResult === null,
    currentUserId: locals.user?.id ?? null,
    form,

    bootSource,
    bootStartForm: await superValidate({}, zod4(bootStartSchema), { id: `bootStart:${params.id}`, errors: false }),
    bootCompileForm: await superValidate({}, zod4(bootCompileSchema), { id: `bootCompile:${params.id}`, errors: false }),
    bootApproveForm: await superValidate(
      { nodeId: bootSource.mode === 'source' && bootSource.compiled ? bootSource.compiled.id : '', revision: bootSource.mode === 'source' && bootSource.compiled ? bootSource.compiled.revision : 1 },
      zod4(bootApproveSchema), { id: `bootApprove:${params.id}`, errors: false },
    ),
    registerDefaults: registerDefaultsResult,
    registerDefaultsForm,
    resetContext,
    resetContextForm,
    memberRolesForm,
    bootPointer,
    canManageAgent,
    // The key a pointer result carries (the action's own params.id), so a
    // result shows only for the Agent it was written for.
    bootPointerKey: params.id,
    addMemoryForm,
    updateMemoryRoleForm,
    removeMemoryForm,
    deleteForm,
  };
};

export const actions: Actions = {
  // portal#1609 (slice C of #1141): the Agent's ticker templates. Who may edit is the server's call
  // (the Agent's manager, hrn:node:hadronmemory.com:specs:cor:agt:080:35) and every write goes with the viewer's own token; the page's
  // `viewerMayEditTickerTemplates` is only a display hint. An edit and a delete name the revision the
  // page read, so a stale one is refused, never retried.
  createTickerTemplate: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('createTickerTemplate', impersonationRefusal(), values);
    const built = buildTemplateCreateInput(fd);
    if ('invalid' in built) return writeFailure('createTickerTemplate', { kind: 'invalid', ...built.invalid }, values);
    try {
      await gqlClient(locals.token).request(CREATE_AGENT_TICKER_TEMPLATE_MUTATION, { agentRef: params.id, input: built.input });
      return { action: 'createTickerTemplate' as const, ok: true as const };
    } catch (e) {
      return writeFailure('createTickerTemplate', classifyTemplateError(e, 'create'), values);
    }
  },

  updateTickerTemplate: async ({ request, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('updateTickerTemplate', impersonationRefusal(), values);
    const built = buildTemplateUpdate(fd);
    if ('invalid' in built) return writeFailure('updateTickerTemplate', { kind: 'invalid', ...built.invalid }, values);
    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION, {
        id: built.id,
        expectedRevision: built.expectedRevision,
        input: built.patch,
      });
      return { action: 'updateTickerTemplate' as const, ok: true as const };
    } catch (e) {
      return writeFailure('updateTickerTemplate', classifyTemplateError(e, 'update'), values);
    }
  },

  deleteTickerTemplate: async ({ request, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('deleteTickerTemplate', impersonationRefusal(), values);
    const built = buildTemplateDelete(fd);
    if ('invalid' in built) return writeFailure('deleteTickerTemplate', { kind: 'invalid', ...built.invalid }, values);
    try {
      await gqlClient(locals.token).request(DELETE_AGENT_TICKER_TEMPLATE_MUTATION, { id: built.id, expectedRevision: built.expectedRevision });
      return { action: 'deleteTickerTemplate' as const, ok: true as const };
    } catch (e) {
      return writeFailure('deleteTickerTemplate', classifyTemplateError(e, 'delete'), values);
    }
  },

  setBase: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(agentBaseSchema), { id: 'agentBase', strict: true });
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(SET_AGENT_BASE_MUTATION, baseVariables(params.id, form.data));
      return message(form, { type: 'success', text: t('agent.inheritance.base-saved', 'Base Agent saved.') });
    } catch (e) {
      return message(form, { type: 'error', text: extractGqlError(e, t('agent.inheritance.base-save-failed', 'Could not update the base Agent.'), ['AGENT_BASE_CYCLE', 'AGENT_BASE_CHAIN_TOO_LONG', 'AGENT_ORG_GRANT_REQUIRED', 'FORBIDDEN']) }, { status: 500 });
    }
  },
  setIndexRefs: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(agentIndexRefsSchema), { id: 'agentIndexRefs', strict: true });
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(SET_AGENT_INDEX_REFS_MUTATION, indexVariables(params.id, form.data));
      return message(form, { type: 'success', text: t('agent.inheritance.indexes-saved', 'Index references saved.') });
    } catch (e) {
      return message(form, { type: 'error', text: extractGqlError(e, t('agent.inheritance.indexes-save-failed', 'Could not update index references.')) }, { status: 500 });
    }
  },
  // portal#1378: "Start a source" for an Agent whose pointer is set but whose
  // `boot:source` is gone (case 1) or that has no pointer at all (case 2). The seed is
  // the current compiled text, read HERE from the pointer: never a page field, and never
  // the legacy `Agent.systemPrompt` (Holger, D3). A pointer-less Agent starts empty. The
  // server alone decides who may write the source (hrn:node:hadronmemory.com:specs:cor:agt:040:11); copy is fixed so
  // neither a refusal's prose nor the seed is echoed.
  startBootSource: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(bootStartSchema), { id: `bootStart:${params.id}`, strict: true });
    if (!form.valid) return fail(400, { form });
    const failed = (text: string, status: 403 | 409 | 500 | 502) => message(form, { type: 'error', text }, { status });
    const client = gqlClient(locals.token);
    // Set just before the write: a failure after it may have committed, so it cannot promise "nothing changed".
    let attempted = false;
    try {
      const agent = (await client.request<{ agent: { systemMemoryId: string | null; bootPromptRef: string | null } | null }>(AGENT_BOOT_START_QUERY, { ref: params.id })).agent;
      if (!agent?.systemMemoryId) return failed(t('boot.start.failed', 'Could not start a source. Nothing changed; try again.'), 500);
      let seed = '';
      if (agent.bootPromptRef) {
        const compiled = await readCompiled(client, agent.bootPromptRef);
        // Never start an empty source over a compiled prompt that exists but could not be read.
        if (!compiled) return failed(t('boot.start.seed-unreadable', 'Could not read the current prompt to start from. Nothing changed; try again.'), 502);
        seed = compiled.content;
      }
      attempted = true;
      await client.request(CREATE_NODE_MUTATION, {
        input: { memoryId: agent.systemMemoryId, loc: BOOT_SOURCE_LOC, name: 'Boot prompt source', role: 'boot-prompt', content: seed },
      });
      return message(form, {
        type: 'success',
        text: agent.bootPromptRef
          ? t('boot.start.done-seeded', 'Source started from the current prompt. Workers get nothing new until it is compiled and approved.')
          : t('boot.start.done-empty', 'Source started. Workers are served it once a compiled revision is approved.'),
      });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      if (code === 'FORBIDDEN' || code === 'BOOT_PROMPT_WORKER_SESSION_REFUSED') {
        return failed(code === 'FORBIDDEN'
          ? t('boot.start.forbidden', 'Only whoever manages this Agent can start its boot prompt source.')
          : t('boot.start.worker-refused', 'Boot prompts are started by their manager signed in as themselves, not through a worker session.'), 403);
      }
      // createNode is create-only: a live node at the loc is refused, never overwritten.
      if (code === 'NodeLocConflictError') {
        return failed(t('boot.start.exists', 'This Agent already has a source. Reload the page to see it.'), 409);
      }
      if (attempted) return failed(t('boot.start.uncertain', 'Could not confirm the source was started. Reload the page to check before trying again.'), 500);
      return failed(t('boot.start.failed', 'Could not start a source. Nothing changed; try again.'), 500);
    }
  },

  // portal#1377 S2, step 3 of the tab's workflow (portal#1485). The compile never approves;
  // the server writes a new unapproved compiled revision and the manager approves it.
  compileBootPrompt: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(bootCompileSchema), { id: `bootCompile:${params.id}`, strict: true });
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);
    try {
      const r = await client.request<{ compileAgentBootPrompt: { revNo: number } }>(COMPILE_AGENT_BOOT_PROMPT_MUTATION, { agentRef: params.id });
      return message(form, { type: 'success', text: t('boot.compile.done', 'Built revision {n}.', { n: r.compileAgentBootPrompt.revNo }) });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const served = await readServedRevision(client, params.id);
      return message(form, { type: 'error', text: compileRefusalText(code, extractGqlErrorExtensions(e)?.position, served) }, { status: compileRefusalStatus(code) });
    }
  },
  // Approve exactly the revision the manager read (hidden field), never "latest".
  approveBootPrompt: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(bootApproveSchema), { id: `bootApprove:${params.id}`, strict: true });
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(APPROVE_NODE_MUTATION, { nodeRef: form.data.nodeId, revision: form.data.revision });
      return message(form, { type: 'success', text: t('boot.approve.done', 'Revision {n} approved. It is ready to serve.', { n: form.data.revision }) });
    } catch (e) {
      const code = extractGqlErrorCode(e);
      const text = code === 'REVISION_MISMATCH'
        ? t('boot.approve.mismatch', 'Someone updated the prompt after you opened it, so nothing was approved. The page has reloaded with the newest revision.')
        : approveRefusalText(code);
      return message(form, { type: 'error', text }, { status: approvalRefusalStatus(code) });
    }
  },

  update: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), agentSettingsFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || undefined;
    const urnSlug = form.data.urnSlug || undefined;
    const description = form.data.description || null;

    // '' → OMIT, never null (#488): updateAgent forbids unsetting/changing a
    // system memory, so an explicit null THROWS when one is attached — and
    // the form's select can degrade to "— None —" whenever the current
    // memory is missing from the options (the org-system-memories list is
    // membership-gated and best-effort). Sending null therefore failed the
    // WHOLE save, visibility included. Omitting the variable makes the
    // resolver skip the field; a real first-attach still sends the id.
    const systemMemoryId = form.data.systemMemoryId || undefined;
    const visibility = form.data.visibility || undefined;
    // #712: send the role VERBATIM, including ''. Blank clears it server-side.
    const { personaRole } = form.data;
    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MUTATION, {
        ref: params.id, name, urn: urnSlug, description, systemMemoryId, visibility,
        personaRole,
      });

      // If a system memory was selected, ensure it has the chatbot scaffold
      if (systemMemoryId) {
        // hadron-server#460: create-only scaffold. The whole block is gated
        // on `conversations` being absent, and every call swallows errors —
        // so on a partially-scaffolded memory a NodeLocConflictError just
        // means "already there" and the existing node is left intact
        // (the old upsert would have overwritten it with scaffold defaults).
        const CREATE = /* GraphQL */ `mutation C($input: CreateNodeInput!) { createNode(input: $input) { id } }`;
        // #335: scope by the agent's system memory. `conversations` exists in
        // every agent's system memory, so an unscoped node(loc:) now errors
        // (AMBIGUOUS_NODE_LOC) instead of silently resolving the wrong one.
        const NODE_Q = /* GraphQL */ `query NodeExists($ref: ID!, $memoryRef: ID!) { node(ref: $ref, memoryRef: $memoryRef) { id } }`;
        const client = gqlClient(locals.token);
        const agentDisplayName = name ?? 'Agent';
        // Check if conversations parent exists; create scaffold if missing
        const hasConversations = await client.request<{ node: { id: string } | null }>(NODE_Q, { ref: 'conversations', memoryRef: systemMemoryId }).catch(() => ({ node: null }));

        if (!hasConversations.node) {
          // conversations parent
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations', name: 'conversations', nodeType: 'system',
            description: 'Conversation designs',
          }}).catch(() => {});

          // setup conversation
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup', name: 'setup', nodeType: 'system',
            description: 'First-time user setup',
            data: { isSetup: true, stageOrder: ['onboard'] },
          }}).catch(() => {});

          // onboard stage
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup:onboard', name: 'onboard', nodeType: 'system',
            description: 'Onboarding stage',
            data: {
              promptRef: 'prompts:setup:onboard',
              extractionSpec: [{ field: 'memory.name', description: "The user's name", shape: 'string' }],
            },
          }}).catch(() => {});

          // prompts parent
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts', name: 'prompts', nodeType: 'system',
            description: 'Prompt templates',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup', name: 'setup', nodeType: 'system',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup:onboard', name: 'onboard', nodeType: 'system',
            content: `You are ${agentDisplayName}.\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
          }}).catch(() => {});

          // partials
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials', name: 'partials', nodeType: 'system',
            description: 'Shared prompt fragments',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials:metadata-spec', name: 'metadata-spec', nodeType: 'system',
            content: "Always respond using the 'respond' tool. Include:\n- message: your response to the user\n- data: any new information you learned\n- next_stage: null to stay, or the next stage name to transition",
          }}).catch(() => {});
        }
      }

      return message(form, { type: 'success', text: 'Changes saved.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update agent') }, { status: 500 });
    }
  },

  // #942: only registerDefaults is sent. The server's updateAgent gate (the
  // agent's owner, or an org ADMIN) decides; the page offers the control to
  // everyone who can read the agent, like the other settings.
  updateRegisterDefaults: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), agentRegisterDefaultsFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION, {
        ref: params.id,
        registerDefaults: { mentionOnly: form.data.mentionOnly },
      });
      return message(form, { type: 'success', text: t('agent.register-defaults.saved', 'Saved. Future installs use this.') });
    } catch (e: unknown) {
      // updateAgent's owner gate refuses with an UNTYPED Error('Forbidden')
      // (INTERNAL_SERVER_ERROR on the wire), so a refusal can't be told from a
      // crash by code. The fallback states what saving needs, not why it failed.
      switch (extractGqlErrorCode(e)) {
        case 'FORBIDDEN':
          return message(form, { type: 'error', text: t('agent.register-defaults.error.forbidden', 'Only the agent’s owner or an organization admin can change this.') }, { status: 403 });
        case 'AGENT_NOT_FOUND':
          return message(form, { type: 'error', text: t('agent.register-defaults.error.not-found', 'This agent is not available to you.') }, { status: 404 });
        default:
          return message(form, { type: 'error', text: t('agent.register-defaults.error.failed', 'The default was not saved. Changing it needs the agent’s owner or an organization admin.') }, { status: 500 });
      }
    }
  },

  // #1275: only resetContextAfterTask is sent, always as an explicit boolean
  // (omitted would mean "unchanged" on the server, so a clear must say false).
  // The server's updateAgent gate decides who may; the page derives no
  // permission, it renders the refusal as text.
  updateResetContext: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), agentResetContextFormAdapter, { id: `resetContext:${params.id}` });
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_RESET_CONTEXT_MUTATION, {
        ref: params.id,
        resetContextAfterTask: form.data.resetContextAfterTask,
      });
      return message(form, { type: 'success', text: t('agent.reset-context.saved', 'Saved.') });
    } catch (e: unknown) {
      // updateAgent's owner gate refuses with an UNTYPED Error('Forbidden'), so
      // a refusal can't be told from a crash by code: the fallback states what
      // saving needs, not why it failed (as for registerDefaults, #942).
      switch (extractGqlErrorCode(e)) {
        case 'FORBIDDEN':
          return message(form, { type: 'error', text: t('agent.reset-context.error.forbidden', 'Only the agent’s owner or an organization admin can change this.') }, { status: 403 });
        case 'AGENT_NOT_FOUND':
          return message(form, { type: 'error', text: t('agent.reset-context.error.not-found', 'This agent is not available to you.') }, { status: 404 });
        default:
          return message(form, { type: 'error', text: t('agent.reset-context.error.failed', 'Not saved. Changing this needs the agent’s owner or an organization admin.') }, { status: 500 });
      }
    }
  },

  // portal#1405 (R211): only memberRoles is sent. The server's updateAgent gate
  // (requireAgentAccess(ADMIN)) decides; the page shows the editor to managers.
  // A malformed role is BAD_USER_INPUT with a message meant for the person, so
  // it lands at the field; any other refusal is a form-level message.
  updateMemberRoles: async ({ request, params, locals }) => {
    // The form's posted `__superform_id` (per Agent, portal#2068) wins over this fallback, so the result finds only that Agent's editor.
    const form = await superValidate(await request.formData(), updateAgentMemberRolesFormAdapter, { id: 'updateMemberRoles' });
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MEMBER_ROLES_MUTATION, {
        ref: params.id,
        memberRoles: form.data.roles,
      });
      return message(form, { type: 'success', text: t('agent.member-roles.saved', 'Saved. Apps using this Agent offer these roles.') });
    } catch (e: unknown) {
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
        return setError(form, 'roles._errors', extractGqlError(e, t('agent.member-roles.error.invalid', 'Those roles were not accepted.'), ['BAD_USER_INPUT']), { status: 400 });
      }
      // The permission sentence is for a refusal only; an internal fault keeps
      // the shared envelope (and its request id), anything else says to retry.
      if (extractGqlErrorCode(e) === 'FORBIDDEN') {
        return message(form, { type: 'error', text: t('agent.member-roles.error.failed', 'The roles were not saved. Changing them needs the Agent’s owner or an organization admin.') }, { status: 403 });
      }
      return message(form, { type: 'error', text: extractGqlError(e, t('agent.member-roles.error.retry', 'The roles were not saved. Try again.'), [], { transport: 'fallback' }) }, { status: 500 });
    }
  },

  // portal#1142 S8 (hadron-server#2219): set or clear the Agent's pointer.
  // The Agent's manager, as themselves; the server decides.
  setBootPrompt: async ({ request, params, locals }) =>
    pointerAction(await request.formData(), 'agent', params.id, (nodeRef) =>
      gqlClient(locals.token).request(SET_AGENT_BOOT_PROMPT_MUTATION, { agentRef: params.id, nodeRef })),

  delete: async ({ request, params, locals }) => {
    const form = await superValidate<DeleteAgentForm>(
      await request.formData(),
      deleteAgentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    try {
      // #647: where to land after delete depends on ownership — an org agent
      // returns to its org grid, a user-owned (org-less) agent to the personal
      // "My agents" list (/app/agents no longer redirects org members to their
      // org). Resolve the org BEFORE deleting (the row is gone afterwards); a
      // lookup failure falls back to the personal list.
      let orgId: string | null = null;
      try {
        const res = await client.request<{ agent: { organizationId: string | null } | null }>(
          AGENT_ORG_QUERY,
          { ref: params.id },
        );
        orgId = res.agent?.organizationId ?? null;
      } catch {
        // Non-fatal — the redirect target degrades to the personal list.
      }
      await client.request(DELETE_AGENT_MUTATION, { ref: params.id });
      redirect(303, orgId ? `/app/orgs/${orgId}/agents` : '/app/agents');
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete agent') },
        { status: 500 },
      );
    }
  },

  addMemory: async ({ request, params, locals }) => {
    const form = await superValidate<AddAgentMemoryForm>(
      await request.formData(),
      addAgentMemoryFormAdapter,
      { id: 'addMemory' },
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentRef: params.id,
        memoryRef: form.data.memoryId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: 'Memory added.' });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to add memory') },
        { status: 500 },
      );
    }
  },

  // #1173: bundle another Agent (an AgentImport edge). The server decides who
  // may and what is legal (one level, no cycle); its sentence is shown as is.
  addBundledAgent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const agentId = String(fd.get('agentId') ?? '').trim();
    const position = Number(fd.get('position'));
    if (!agentId) return fail(400, { bundleError: 'Select an agent to bundle.' });
    if (!Number.isInteger(position) || position < 1) {
      return fail(400, { bundleError: 'Could not work out where to add it. Reload and try again.' });
    }
    try {
      await gqlClient(locals.token).request(PUBLISH_AGENT_IMPORT_MUTATION, {
        importedAgentRef: agentId,
        parentAgentRef: params.id,
        position,
        required: fd.get('required') === 'on',
      });
      return { bundleAdded: true };
    } catch (e: unknown) {
      return fail(500, { bundleError: extractGqlError(e, 'Failed to bundle the agent', ['SelfImportError', 'MultiLevelImportError', 'MissingGrantError', 'PositionConflictError']) });
    }
  },

  updateMemoryRole: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), updateAgentMemoryRoleFormAdapter, { id: 'updateMemoryRole' });
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MEMORY_ROLE_MUTATION, {
        agentRef: params.id,
        memoryRef: form.data.memoryId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: 'Memory role updated.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update memory role') }, { status: 500 });
    }
  },

  removeMemory: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), removeAgentMemoryFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(REMOVE_MEMORY_FROM_AGENT_MUTATION, {
        agentRef: params.id,
        memoryRef: form.data.memoryId,
      });
      return message(form, { type: 'success', text: 'Memory removed.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to remove memory') }, { status: 500 });
    }
  },

};
