import { agentBaseSchema, agentIndexRefsSchema } from './inheritance-schema';
import { loadInheritanceManagement, baseVariables, indexVariables, SET_AGENT_BASE_MUTATION, SET_AGENT_INDEX_REFS_MUTATION } from '$lib/server/agent-inheritance-write';
import { loadAgentInheritance } from '$lib/server/agent-inheritance';
import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { pointerAction, readPointer, selfCanManage } from '$lib/server/boot-prompt-pointer';
import { drainFindNodes, fetchAllItems } from '$lib/server/paginate';
import { fetchOwnedMemoriesLite } from '$lib/server/personal-memories';
import type { OwnedMemoryLite } from '$lib/server/personal-memories';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
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
  DELETE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
  UPDATE_AGENT_MEMORY_ROLE_MUTATION,
  REMOVE_MEMORY_FROM_AGENT_MUTATION,
  AI_SERVICE_CONFIGS_QUERY,
  AGENT_REGISTER_DEFAULTS_QUERY,
  AGENT_BOOT_POINTER_QUERY,
  SET_AGENT_BOOT_PROMPT_MUTATION,
  UPDATE_AGENT_REGISTER_DEFAULTS_MUTATION,
  APP_ORG_AGENT_GRANTS_QUERY,
  PUBLISH_AGENT_IMPORT_MUTATION,
} from '$lib/server/queries';
import type { Agent, Organization, Memory, MemoryNode, AiServiceConfig } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  addAgentMemorySchema,
  agentRegisterDefaultsSchema,
  agentSettingsSchema,
  deleteAgentSchema,
  removeAgentMemorySchema,
  updateAgentMemoryRoleSchema,
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
const addAgentMemoryFormAdapter = zod4(addAgentMemorySchema);
const updateAgentMemoryRoleFormAdapter = zod4(updateAgentMemoryRoleSchema);
const removeAgentMemoryFormAdapter = zod4(removeAgentMemorySchema);
const deleteAgentFormAdapter = zod4(deleteAgentSchema);

type AddAgentMemoryForm = Infer<typeof addAgentMemorySchema, 'zod4'>;
type DeleteAgentForm = Infer<typeof deleteAgentSchema, 'zod4'>;

function urnSlug(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

export const load: PageServerLoad = async ({ params, locals }) => {
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
    .catch(() => {
      throw error(500, 'Failed to load agent');
    });
  const agent = agentRes.agent;
  if (!agent) throw error(404, 'Agent not found or no longer available');

  // Org chrome only for org-owned agents. A user-owned agent (organizationId
  // null) belongs to no org — the page renders the org-less variant (org null,
  // no org name / install / org system-memory picker).
  let org: Organization | null = null;
  let orgs: Organization[] = [];
  if (agent.organizationId) {
    orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');
    org = orgs.find((o) => o.id === agent.organizationId) ?? null;
    if (!org) throw error(404, 'Agent not found or no longer available');
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
    agentId: string | null;
    agents?: Array<{
      id: string;
      name: string;
      urn: string;
      description: string | null;
      personaRole: string | null;
    }>;
  };

  const [nodesResult, sysMemResult, configsResult, orgAppsResult, ownedAppsResult, personalMemsResult, registerDefaultsResult, inheritance, inheritanceManagement, bootPointer, canManageAgent] = await Promise.all([
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
    // Apps this agent is installed into (member-scoped, all caller orgs).
    // Non-fatal: on failure the Apps tab just shows none.
    fetchAllItems<AgentAppLite>(client, AGENT_APPS_QUERY, 'apps').catch(() => [] as AgentAppLite[]),
    // …plus the caller's OWN org-less apps. `apps()` routes on org membership,
    // so a user-owned App is only reachable through filter.ownedByMe (#782) —
    // without this a personal team App showed neither in the Apps tab nor in
    // Bundled agents, though createTeamPersona supports one (#714 review).
    fetchAllItems<AgentAppLite>(client, AGENT_OWNED_APPS_QUERY, 'apps').catch(() => [] as AgentAppLite[]),
    // #642: the caller's OWN personal memories, offered as "Add memory" options
    // for a personal agent. Gated on `!org && visibility !== 'PUBLIC'`, which
    // means the caller OWNS a non-PUBLIC org-less agent: agent(ref:) only returns
    // a non-PUBLIC user-owned agent to its owner (owner-only access), and a PUBLIC
    // agent can't hold owner-only memories anyway (congruence). So this never
    // offers personal memories on someone else's PUBLIC agent, nor on an
    // org-visible agent (review #661). Slim projection; non-fatal.
    !org && agent.visibility !== 'PUBLIC'
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
    loadAgentInheritance(client, agent.id),
    loadInheritanceManagement(client, agent.id, agent.urn, locals.user?.id ?? null, !!locals.impersonation),
    // portal#1142 S8: the Agent's boot-prompt pointer (its own read, so a
    // failure is not a null pointer), and whether to offer its form.
    readPointer(
      () => client.request<{ agent: { bootPromptRef: string | null; bootPromptTargetDeleted: boolean | null } | null }>(AGENT_BOOT_POINTER_QUERY, { ref: agent.id }),
      (r) => r.agent,
      `agent ${agent.id}`,
    ),
    selfCanManage(client, locals.user?.id, agent.urn),
  ]);

  // An agent can be installed into several apps (as the primary agentId or via
  // the AppAgent join), and an app can host several agents — match on both.
  const agentId = agent.id;
  // The two app lists can overlap for a platform admin, so de-dupe by app id
  // before anything counts or lists them.
  const appsById = new Map<string, AgentAppLite>();
  for (const a of [...(orgAppsResult ?? []), ...(ownedAppsResult ?? [])]) {
    if (!appsById.has(a.id)) appsById.set(a.id, a);
  }
  const appsWithThisAgent = [...appsById.values()]
    .filter((a) => a.agentId === agentId || (a.agents ?? []).some((x) => x.id === agentId));
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
  // portal#1148 (hadron-server#2089): an App whose `agents` is null WITHHOLDS its roster, and the
  // server withholds `agentId` with it — so such an App can be absent from `appsWithThisAgent`
  // (the link-based filter above needs a visible link). Whether it installs this agent, and what
  // its siblings are, is UNKNOWN, not "none": counted from ALL the Apps, before that filter, so
  // the tab can say its list may be incomplete (George, LOCAL on #1150).
  const bundledWithheldApps = [...appsById.values()].filter(
    (a) => a.agents === null && (a.agentId === null || a.agentId === agentId),
  ).length;
  for (const app of appsWithThisAgent) {
    for (const sibling of app.agents ?? []) {
      if (sibling.id === agentId || bundledById.has(sibling.id)) continue;
      bundledById.set(sibling.id, {
        id: sibling.id,
        name: sibling.name,
        urn: sibling.urn,
        description: sibling.description ?? null,
        personaRole: sibling.personaRole ?? null,
        via: app.name,
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
  const [form, registerDefaultsForm, addMemoryForm, updateMemoryRoleForm, removeMemoryForm, deleteForm] = await Promise.all([
    superValidate({
      name: agent.name ?? '',
      urnSlug: urnSlug(agent.urn),
      description: agent.description ?? '',
      systemPrompt: agent.systemPrompt ?? '',
      visibility: agent.visibility ?? 'ORGANIZATION',
      systemMemoryId: '',
      personaRole: agent.personaRole ?? '',
    }, agentSettingsFormAdapter, { errors: false }),
    superValidate(
      { mentionOnly: registerDefaultsResult?.mentionOnly ?? false },
      agentRegisterDefaultsFormAdapter,
      { errors: false },
    ),
    superValidate<AddAgentMemoryForm>(
      { memoryId: '', role: 'read' },
      addAgentMemoryFormAdapter,
      { errors: false },
    ),
    superValidate(
      { memoryId: '', role: 'read' },
      updateAgentMemoryRoleFormAdapter,
      { errors: false },
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
  return {
    inheritanceManagement, baseForm, indexRefsForm,
    inheritance,
    agent,
    org,
    agentNodes,
    agentNodesError,
    installedApps,
    bundledAgents,
    bundleCandidates,
    bundleCandidatesError,
    nextImportPosition,
    bundledWithheldApps,
    allOrgs: orgs,
    orgSystemMemories,
    // Empty for an org agent; the caller's own memories for a user-owned agent (#642).
    personalMemories: personalMemsResult,
    agentConfigs: configsResult ?? [],
    configsError: configsResult === null,
    currentUserId: locals.user?.id ?? null,
    form,
    registerDefaults: registerDefaultsResult,
    registerDefaultsForm,
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
  setBase: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), zod4(agentBaseSchema), { id: 'agentBase', strict: true });
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(SET_AGENT_BASE_MUTATION, baseVariables(params.id, form.data));
      return message(form, { type: 'success', text: t('agent.inheritance.base-saved', 'Base Agent saved.') });
    } catch (e) {
      return message(form, { type: 'error', text: extractGqlError(e, t('agent.inheritance.base-save-failed', 'Could not update the base Agent.')) }, { status: 500 });
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
  update: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), agentSettingsFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || undefined;
    const urnSlug = form.data.urnSlug || undefined;
    const description = form.data.description || null;
    const systemPrompt = form.data.systemPrompt || null;
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
        ref: params.id, name, urn: urnSlug, description, systemPrompt, systemMemoryId, visibility,
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
            content: `You are ${agentDisplayName}.${systemPrompt ? ' ' + systemPrompt : ''}\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
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
      return fail(500, { bundleError: extractGqlError(e, 'Failed to bundle the agent') });
    }
  },

  updateMemoryRole: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), updateAgentMemoryRoleFormAdapter);
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
