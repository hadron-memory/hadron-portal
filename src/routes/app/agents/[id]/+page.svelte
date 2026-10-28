<script lang="ts">
  import BootPrompt from './BootPrompt.svelte';
  import AgentInheritanceSettings from '$lib/components/AgentInheritanceSettings.svelte';
  import AgentExtendedBy from '$lib/components/AgentExtendedBy.svelte';
  import type { NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import AgentDefinitions from '$lib/components/AgentDefinitions.svelte';
  import { tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import NodeTable, { type NodeRow } from '$lib/components/NodeTable.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import SelectOrg from '$lib/components/SelectOrg.svelte';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { eligibleCloneTargets, showCloneEntry } from '$lib/agents/clone';
  import BootPromptPointer from '$lib/components/BootPromptPointer.svelte';
  import { pointerResultFor, type PointerResult } from '$lib/boot-prompt-pointer';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import type { MemoryNode, OrgSummary } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import {
    addAgentMemorySchema,
    agentRegisterDefaultsSchema,
    agentSettingsSchema,
    deleteAgentSchema,
    removeAgentMemorySchema,
    updateAgentMemoryRoleSchema,
  } from './schema';

  type AgentSettingsForm = Infer<typeof agentSettingsSchema, 'zod4'>;
  type AgentRegisterDefaultsForm = Infer<typeof agentRegisterDefaultsSchema, 'zod4'>;
  type AddAgentMemoryForm = Infer<typeof addAgentMemorySchema, 'zod4'>;
  type UpdateAgentMemoryRoleForm = Infer<typeof updateAgentMemoryRoleSchema, 'zod4'>;
  type RemoveAgentMemoryForm = Infer<typeof removeAgentMemorySchema, 'zod4'>;
  type DeleteAgentForm = Infer<typeof deleteAgentSchema, 'zod4'>;
  type AgentSettingsSuperform = SuperValidated<AgentSettingsForm, App.Superforms.Message, AgentSettingsForm>;
  type AgentRegisterDefaultsSuperform = SuperValidated<AgentRegisterDefaultsForm, App.Superforms.Message, AgentRegisterDefaultsForm>;
  type AddAgentMemorySuperform = SuperValidated<AddAgentMemoryForm, App.Superforms.Message, AddAgentMemoryForm>;
  type UpdateAgentMemoryRoleSuperform = SuperValidated<UpdateAgentMemoryRoleForm, App.Superforms.Message, UpdateAgentMemoryRoleForm>;
  type RemoveAgentMemorySuperform = SuperValidated<RemoveAgentMemoryForm, App.Superforms.Message, RemoveAgentMemoryForm>;
  type DeleteAgentSuperform = SuperValidated<DeleteAgentForm, App.Superforms.Message, DeleteAgentForm>;

  // #713: one row of the Bundled agents grid. `via` names what bundles it —
  // the App it is co-installed in, or "Import" for an AgentImport edge.
  interface BundledAgentRow {
    id: string;
    name: string;
    urn: string;
    description: string | null;
    personaRole: string | null;
    via: string;
  }

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);
  // #647: the "Agents" list this agent belongs to — the org grid for an org
  // agent, the personal "My agents" list for a user-owned (org-less) one. Since
  // /app/agents stopped redirecting org members to their org grid, org-agent
  // exits (breadcrumb, delete) must target the org list explicitly.
  const agentsHref = $derived(org ? `/app/orgs/${org.id}/agents` : '/app/agents');
  // #636/#710: the edit form shows the agent's URN prefix — everything before
  // the final ':' slug segment of the AGENT's own URN. Using the org URN here
  // (the old org branch) rendered the wrong resource type: `hrn:org:acme.com:`
  // in front of a slug that composes an `hrn:agent:acme.com:` URN.
  const urnPrefix = $derived(agent.urn.slice(0, Math.max(0, agent.urn.lastIndexOf(':'))));
  const orgSystemMemories = $derived((data as any).orgSystemMemories ?? []);
  // Apps this agent is installed into (built server-side from the AppAgent join).
  const installedApps = $derived(
    (data as { installedApps?: Array<{ id: string; name: string; urn: string; orgId: string }> })
      .installedApps ?? [],
  );
  // The loader reads the Apps list in two calls; a failed call is not an empty
  // list, so it travels as its own flag.
  const installedAppsError = $derived(!!(data as { installedAppsError?: boolean }).installedAppsError);
  const writableMemoryIds = $derived((agent.memoryItems ?? []).filter((m) => m.role === 'read-write').map((m) => m.memory.id));
  // #713: agents bundled with this one — co-installed siblings plus AgentImport
  // edges, assembled server-side (see the loader for why siblings are the source
  // of truth for a Team Agent's personas).
  // #1173: what the Bundled tab can add (see the loader). An agent with nothing
  // bundled yet still gets the tab when there is something to add to it.
  const bundleCandidates = $derived(
    (data as { bundleCandidates?: Array<{ id: string; name: string; urn: string }> }).bundleCandidates ?? [],
  );
  const bundleCandidatesError = $derived(
    (data as { bundleCandidatesError?: boolean }).bundleCandidatesError ?? false,
  );
  const nextImportPosition = $derived((data as { nextImportPosition?: number }).nextImportPosition ?? 1);
  const bundleResult = $derived(form as { bundleError?: string; bundleAdded?: boolean } | null);
  let bundling = $state(false);
  const bundledMayBeIncomplete = $derived((data as { bundledMayBeIncomplete?: boolean }).bundledMayBeIncomplete ?? false);
  const bundledAgents = $derived(
    (data as { bundledAgents?: BundledAgentRow[] }).bundledAgents ?? [],
  );

  // Agents with a system memory get the Chatbot Control tab. The chatbot
  // sub-tab system opens per-conversation or per-partial sub-tabs when the
  // user clicks a row, so they can drill down without leaving the page.
  const hasSystemMemory = $derived(!!agent.systemMemoryId);

  // #352 tab reorg: Profile (agent info) is the landing tab; Memories and
  // AI Providers were split out of the old Settings tab; the old "Memory"
  // node browser is now "Nodes"; Settings keeps the danger zone.
  type TabId = 'tasks' | 'processes' | 'profile' | 'boot' | 'memories' | 'apps' | 'bundled' | 'nodes' | 'chatbot' | 'ai' | 'settings';
  let activeTab = $state<TabId>('profile');

  // ── Chatbot Control sub-tab state ────────────────────────────────────
  // The Chatbot Control tab has an "index" view (lists conversations +
  // partials) and zero or more per-item sub-tabs that the user has opened
  // by clicking a row.

  interface ChatbotSubTab {
    id: string;           // 'index' | `conv:${loc}` | `partial:${loc}`
    label: string;
    kind?: 'conversation' | 'partial';
    loc?: string;         // set for conversation and partial sub-tabs
  }

  let openSubTabs = $state<ChatbotSubTab[]>([{ id: 'index', label: 'Overview' }]);
  let activeSubTab = $state<string>('index');

  function openConversationTab(loc: string, label: string) {
    const tabId = `conv:${loc}`;
    if (!openSubTabs.find((t) => t.id === tabId)) {
      openSubTabs = [...openSubTabs, { id: tabId, label, kind: 'conversation', loc }];
    }
    activeSubTab = tabId;
  }

  function openPartialTab(loc: string, label: string) {
    const tabId = `partial:${loc}`;
    if (!openSubTabs.find((t) => t.id === tabId)) {
      openSubTabs = [...openSubTabs, { id: tabId, label, kind: 'partial', loc }];
    }
    activeSubTab = tabId;
  }

  function closeSubTab(id: string) {
    if (id === 'index') return; // overview is always present
    openSubTabs = openSubTabs.filter((t) => t.id !== id);
    if (activeSubTab === id) activeSubTab = 'index';
  }

  // ── Chatbot data derivations ─────────────────────────────────────────
  // All nodes in the agent's system memory, sliced into conversations,
  // their stages, and the partials under prompts:partials.

  const systemNodes = $derived<MemoryNode[]>(
    (data.agentNodes ?? []).filter((n) => n.memoryId === agent.systemMemoryId),
  );

  // Memory URN for the system memory (used to render full node URNs)
  const systemMemoryUrn = $derived(
    (agent.memoryItems ?? []).find((m) => m.memory.id === agent.systemMemoryId)?.memory.urn ?? '',
  );

  function nodeToRow(n: MemoryNode): NodeRow {
    return {
      id: n.id,
      loc: n.loc,
      name: n.name,
      description: n.description,
      nodeType: n.nodeType,
      // Loader can return system-memory nodes even when the agent's
      // memoryItems doesn't include the system memory, leaving
      // systemMemoryUrn empty. Render bare loc as fallback rather than
      // crash the page; data-shape fix belongs at the loader.
      // R-2 (2026-05-06): also guard empty n.loc for the same reason.
      urn: systemMemoryUrn && n.loc ? composeNodeUrn(systemMemoryUrn, n.loc) : n.loc,
    };
  }

  // Conversations: nodes directly under "conversations:" (depth 2)
  const conversationRows = $derived<NodeRow[]>(
    systemNodes
      .filter((n) => n.loc.startsWith('conversations:') && n.loc.split(':').length === 2)
      .sort((a, b) => a.loc.localeCompare(b.loc))
      .map(nodeToRow),
  );

  // Tabs (#352): Profile · Memories · Nodes · [Chatbot Control] · AI Providers
  // · Settings. Chatbot Control is shown only when the agent has a system
  // memory; it sits next to Nodes because it drills into the system memory's
  // conversation nodes. The live chatbot is exercised from an App (App
  // detail → Chat tab), not the agent builder; agent-level testing lives on
  // the /test tester.
  const tabs = $derived<{ id: TabId; label: string }[]>([
    { id: 'profile', label: 'Profile' },
    { id: 'boot', label: t('agent.boot.tab', 'Boot prompt') },
    { id: 'tasks', label: t('agent.tasks.tab', 'Tasks') },
    { id: 'processes', label: t('agent.processes.tab', 'Processes') },
    { id: 'memories', label: 'Memories' },
    { id: 'apps', label: 'Apps' },
    // #713: only for an agent that actually bundles others (a Team Agent and
    // its personas) — an always-empty tab on every ordinary agent is noise,
    // same reasoning as Chatbot Control below.
    ...(bundledAgents.length > 0 || bundledMayBeIncomplete || bundleCandidates.length > 0 || bundleCandidatesError ? [{ id: 'bundled' as TabId, label: 'Bundled agents' }] : []),
    { id: 'nodes', label: 'Nodes' },
    ...(hasSystemMemory ? [{ id: 'chatbot' as TabId, label: 'Chatbot Control' }] : []),
    { id: 'ai', label: 'AI Providers' },
    { id: 'settings', label: 'Settings' },
  ]);

  // Partials: nodes under "prompts:partials:" (depth 3), exclude the parent
  // "prompts:partials" itself.
  const partialRows = $derived<NodeRow[]>(
    systemNodes
      .filter((n) => n.loc.startsWith('prompts:partials:') && n.loc.split(':').length === 3)
      .sort((a, b) => a.loc.localeCompare(b.loc))
      .map(nodeToRow),
  );

  // Stages belonging to a given conversation loc (e.g. "conversations:setup")
  function stageRowsFor(conversationLoc: string): NodeRow[] {
    return systemNodes
      .filter((n) => n.loc.startsWith(conversationLoc + ':') && n.loc.split(':').length === 3)
      .sort((a, b) => a.loc.localeCompare(b.loc))
      .map(nodeToRow);
  }

  // Used by the partial sub-tab to show the partial's content
  function nodeAtLoc(loc: string): MemoryNode | undefined {
    return systemNodes.find((n) => n.loc === loc);
  }

  const initialAgentSettingsForm = untrack(() => submittedForm<AgentSettingsForm>(form, 'agentSettings') as AgentSettingsSuperform | null ?? data.form);
  const {
    form: agentSettingsForm,
    errors: agentSettingsErrors,
    constraints: agentSettingsConstraints,
    message: agentSettingsMessage,
    allErrors: agentSettingsAllErrors,
    submitting: agentSettingsSubmitting,
    enhance: agentSettingsEnhance,
  } = superForm<AgentSettingsForm, App.Superforms.Message, AgentSettingsForm>(initialAgentSettingsForm, {
    validators: zod4Client(agentSettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const initialRegisterDefaultsForm = untrack(() => submittedForm<AgentRegisterDefaultsForm>(form, 'registerDefaults') as AgentRegisterDefaultsSuperform | null ?? data.registerDefaultsForm);
  const {
    form: registerDefaultsForm,
    message: registerDefaultsMessage,
    submitting: registerDefaultsSubmitting,
    enhance: registerDefaultsEnhance,
    isTainted: registerDefaultsIsTainted,
    reset: registerDefaultsReset,
  } = superForm<AgentRegisterDefaultsForm, App.Superforms.Message, AgentRegisterDefaultsForm>(initialRegisterDefaultsForm, {
    validators: zod4Client(agentRegisterDefaultsSchema),
    validationMethod: 'oninput',
    clearOnSubmit: 'none',
    // The default (true) restores the PAGE-LOAD value after a successful save,
    // so the box showed the opposite of what was just saved (#971 QA). Keep the
    // returned form, which carries the saved value and is untainted on success.
    resetForm: false,
  });
  // #942: this component is reused across /app/agents/[id] navigations.
  // - Another AGENT: reset to its value, dropping A's edits and A's banner, so
  //   A's value can never post to B.
  // - The SAME agent re-read (another form on the page saved): reseed only a
  //   clean form, so an unsaved change here survives (#971 Codex P2). A save of
  //   THIS form arrives untainted with the saved value, so it keeps its "Saved".
  // - The FIRST run is skipped: the store was just seeded, either from the
  //   loader or from a full-page (no-JS) submission's action form, and the
  //   latter must keep the value the user tried to save beside its error
  //   (#971 Codex P2).
  let registerDefaultsAgentId = untrack(() => data.agent.id);
  let registerDefaultsSeeded = false;
  $effect(() => {
    const seeded = data.registerDefaults?.mentionOnly ?? false;
    const agentId = data.agent.id;
    untrack(() => {
      if (!registerDefaultsSeeded) {
        registerDefaultsSeeded = true;
      } else if (agentId !== registerDefaultsAgentId) {
        registerDefaultsAgentId = agentId;
        registerDefaultsReset({ data: { mentionOnly: seeded }, newState: { mentionOnly: seeded } });
      } else if (!registerDefaultsIsTainted()) {
        registerDefaultsForm.update((current) => ({ ...current, mentionOnly: seeded }), { taint: false });
      }
    });
  });
  // "Saved" describes the value that was saved. Once the box is edited again it
  // would sit beside an unsaved value, so an edit clears it (#971 Codex P2).
  // An error stays: it still describes the last attempt.
  function clearSavedBanner() {
    if ($registerDefaultsMessage?.type === 'success') registerDefaultsMessage.set(undefined);
  }
  const registerDefaultsError = $derived($registerDefaultsMessage?.type === 'error' ? $registerDefaultsMessage.text : null);
  const registerDefaultsSuccess = $derived($registerDefaultsMessage?.type === 'success' ? $registerDefaultsMessage.text : null);

  const initialAddMemoryForm = untrack(() => submittedForm<AddAgentMemoryForm>(form, 'addMemory') as AddAgentMemorySuperform | null ?? data.addMemoryForm);
  const {
    form: addMemoryForm,
    errors: addMemoryErrors,
    message: addMemoryMessage,
    submitting: addMemorySubmitting,
    enhance: addMemoryEnhance,
  } = superForm<AddAgentMemoryForm, App.Superforms.Message, AddAgentMemoryForm>(initialAddMemoryForm, {
    validators: zod4Client(addAgentMemorySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') {
        addMemoryForm.update((current) => ({ ...current, memoryId: '' }), { taint: false });
      }
    },
  });

  const initialUpdateMemoryRoleForm = untrack(() => submittedForm<UpdateAgentMemoryRoleForm>(form, 'updateMemoryRole') as UpdateAgentMemoryRoleSuperform | null ?? data.updateMemoryRoleForm);
  const {
    form: updateMemoryRoleForm,
    errors: updateMemoryRoleErrors,
    message: updateMemoryRoleMessage,
    submitting: updateMemoryRoleSubmitting,
    enhance: updateMemoryRoleEnhance,
  } = superForm<UpdateAgentMemoryRoleForm, App.Superforms.Message, UpdateAgentMemoryRoleForm>(initialUpdateMemoryRoleForm, {
    validators: zod4Client(updateAgentMemoryRoleSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialRemoveMemoryForm = untrack(() => submittedForm<RemoveAgentMemoryForm>(form, 'removeMemory') as RemoveAgentMemorySuperform | null ?? data.removeMemoryForm);
  const {
    form: removeMemoryForm,
    errors: removeMemoryErrors,
    message: removeMemoryMessage,
    submitting: removeMemorySubmitting,
    enhance: removeMemoryEnhance,
  } = superForm<RemoveAgentMemoryForm, App.Superforms.Message, RemoveAgentMemoryForm>(initialRemoveMemoryForm, {
    validators: zod4Client(removeAgentMemorySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const initialDeleteForm = untrack(() => submittedForm<DeleteAgentForm>(form, 'deleteAgent') as DeleteAgentSuperform | null ?? data.deleteForm);
  const {
    form: deleteForm,
    errors: deleteErrors,
    message: deleteMessage,
    submitting: deleteSubmitting,
    enhance: deleteEnhance,
  } = superForm<DeleteAgentForm, App.Superforms.Message, DeleteAgentForm>(initialDeleteForm, {
    validators: zod4Client(deleteAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  let isEditing = $state(untrack(() => {
    const submitted = submittedForm<AgentSettingsForm>(form, 'agentSettings') as AgentSettingsSuperform | null;
    return !!submitted && submitted.message?.type !== 'success';
  }));
  let confirmDelete = $state(untrack(() => !!submittedForm<DeleteAgentForm>(form, 'deleteAgent')));

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function urnSlug(urn: string): string {
    // The agent slug is the LAST ':'-segment. `Agent.urn` is server-canonicalized
    // (e.g. `hrn:agent:<org>::<slug>`), so dropping only the FIRST segment left
    // `agent:<org>::<slug>` in the edit box — which updateAgent would then
    // slugify back INTO the stored slug, corrupting the URN on save (same class
    // as the app-detail slugOfUrn bug). Take the final segment only.
    const idx = urn.lastIndexOf(':');
    return idx >= 0 ? urn.slice(idx + 1) : urn;
  }

  function openEdit() {
    agentSettingsForm.update((current) => ({
      ...current,
      name: agent.name ?? '',
      urnSlug: urnSlug(agent.urn),
      description: agent.description ?? '',
      systemPrompt: agent.systemPrompt ?? '',
      visibility: agent.visibility ?? 'ORGANIZATION',
      systemMemoryId: '',
      personaRole: agent.personaRole ?? '',
    }), { taint: false });
    isEditing = true;
  }

  const agentSettingsActionError = $derived(
    $agentSettingsMessage?.type === 'error'
      ? $agentSettingsMessage.text
      : ($agentSettingsAllErrors[0]?.messages[0] ?? null),
  );
  const agentNameError = $derived($agentSettingsErrors.name?.[0] ?? null);
  const agentUrnError = $derived($agentSettingsErrors.urnSlug?.[0] ?? null);
  const addMemoryError = $derived($addMemoryErrors.memoryId?.[0] ?? null);
  const addMemoryActionError = $derived($addMemoryMessage?.type === 'error' ? $addMemoryMessage.text : $addMemoryErrors._kind?.[0] ?? null);
  const addMemoryActionSuccess = $derived($addMemoryMessage?.type === 'success' ? $addMemoryMessage.text : null);
  const updateMemoryRoleActionError = $derived(
    $updateMemoryRoleMessage?.type === 'error'
      ? $updateMemoryRoleMessage.text
      : $updateMemoryRoleErrors.memoryId?.[0] ?? $updateMemoryRoleErrors.role?.[0] ?? $updateMemoryRoleErrors._kind?.[0] ?? null,
  );
  const updateMemoryRoleActionSuccess = $derived($updateMemoryRoleMessage?.type === 'success' ? $updateMemoryRoleMessage.text : null);
  const removeMemoryActionError = $derived(
    $removeMemoryMessage?.type === 'error'
      ? $removeMemoryMessage.text
      : $removeMemoryErrors.memoryId?.[0] ?? $removeMemoryErrors._kind?.[0] ?? null,
  );
  const removeMemoryActionSuccess = $derived($removeMemoryMessage?.type === 'success' ? $removeMemoryMessage.text : null);
  const deleteActionError = $derived(
    $deleteMessage?.type === 'error'
      ? $deleteMessage.text
      : $deleteErrors._kind?.[0] ?? null,
  );

  $effect(() => {
    if ($agentSettingsMessage?.type === 'success') isEditing = false;
  });
  $effect(() => {
    const submitted = submittedForm<AddAgentMemoryForm>(form, 'addMemory') as AddAgentMemorySuperform | null;
    if (submitted && (!submitted.valid || submitted.message?.type === 'error')) {
      activeTab = 'memories';
    }
  });
  $effect(() => {
    const submittedUpdate = submittedForm<UpdateAgentMemoryRoleForm>(form, 'updateMemoryRole');
    const submittedRemove = submittedForm<RemoveAgentMemoryForm>(form, 'removeMemory');
    if (submittedUpdate || submittedRemove) activeTab = 'memories';
  });
  $effect(() => {
    if (submittedForm<DeleteAgentForm>(form, 'deleteAgent')) {
      activeTab = 'settings';
      confirmDelete = true;
    }
  });
  // #942: a full-page (no-JS) save of the register default comes back as a
  // fresh page on Profile; open Settings so its result and the attempted value
  // are visible, as the delete form above does (#971 Codex P2).
  $effect(() => {
    if (submittedForm<AgentRegisterDefaultsForm>(form, 'registerDefaults') || submittedForm<{ _kind: 'setAgentBase' }>(form, 'setAgentBase') || submittedForm<{ _kind: 'setAgentIndexRefs' }>(form, 'setAgentIndexRefs')) activeTab = 'settings';
  });
  // portal#1142 S8: a no-JS pointer result opens Settings too, where it shows.
  $effect(() => {
    if ((form as { pointer?: PointerResult } | null)?.pointer) activeTab = 'settings';
  });

  // A delayed action from another route instance must not seed this editor
  // or reopen it. Superforms also uses this route-specific id to isolate stores.
  const bootPromptSubmission = $derived.by(() => {
    const result = submittedForm(form, 'bootPrompt') as typeof data.bootPromptForm | null;
    return result?.id === data.bootPromptForm?.id ? result : null;
  });
  $effect(() => {
    if (bootPromptSubmission) activeTab = 'boot';
  });

  function submitMemoryRoleChange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const memoryId = select.dataset.memoryId ?? '';
    updateMemoryRoleForm.update(
      (current) => ({ ...current, memoryId, role: select.value as UpdateAgentMemoryRoleForm['role'] }),
      { taint: false },
    );
    select.form?.requestSubmit();
  }

  function setRemoveMemory(memoryId: string) {
    removeMemoryForm.update((current) => ({ ...current, memoryId }), { taint: false });
  }

  // #1020: Remove lives in the memory row's ⋯ menu; one hidden form below the
  // table is submitted for the picked memory. No confirm, as before.
  let removeMemoryFormEl = $state<HTMLFormElement | null>(null);
  async function removeMemory(memoryId: string) {
    if ($removeMemorySubmitting) return;
    setRemoveMemory(memoryId);
    await tick();
    removeMemoryFormEl?.requestSubmit();
  }

  // Label for the agent's own visibility (PERSONAL/ORGANIZATION/PUBLIC).
  // The old "mixed visibility" warnings (agent vs more-restrictive memory) were
  // removed with #610: the Agent-PUBLIC congruence invariant (hrn:node:hadronmemory.com:specs:cor:acl:080:03) is
  // now enforced server-side, so an incongruent PUBLIC state can't be reached,
  // and the warnings were confusing for the non-PUBLIC cases.
  const visibilityLabel: Record<string, string> = { PERSONAL: 'Personal', ORGANIZATION: 'Organization', PUBLIC: 'Public' };

  let selectMemoryOpen = $state(false);

  const memoryIdsInAgent = $derived(new Set((agent.memoryItems ?? []).map((item) => item.memory.id)));
  const allMemories = $derived.by(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; urn: string; name: string; visibility?: string | null; class?: string; orgName?: string }> = [];
    for (const o of (data as any).allOrgs ?? (org ? [org] : [])) {
      for (const m of o.memories ?? []) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          result.push({ ...m, orgName: o.name });
        }
      }
      for (const s of o.subscriptions ?? []) {
        if (!seen.has(s.memory.id)) {
          seen.add(s.memory.id);
          result.push({ ...s.memory, orgName: s.memory.organization?.name ?? o.name });
        }
      }
    }
    // Include system memories fetched separately (they're excluded from
    // org.memories but needed for the "Add memory" and system-memory
    // selector dropdowns).
    for (const m of orgSystemMemories) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.push({ ...m, orgName: org?.name ?? '' });
      }
    }
    // #642: for a user-owned (org-less) agent, the caller's OWN personal memories
    // are the "Add memory" source (the loader sends none for an org agent).
    for (const m of ((data as any).personalMemories ?? []) as Array<{ id: string; urn: string; name: string; visibility?: string | null; class?: string }>) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.push({ ...m, orgName: '' });
      }
    }
    return result;
  });
  const availableMemories = $derived(allMemories.filter((m) => !memoryIdsInAgent.has(m.id) && m.class !== 'system'));
  // The agent's own system memory is NOT part of memoryItems; surface it on the
  // Memories tab as a fixed, read-only entry (can't be reassigned or removed).
  const systemMemory = $derived(
    agent.systemMemoryId ? allMemories.find((m) => m.id === agent.systemMemoryId) ?? null : null,
  );
  // The memory chosen in the "Add memory" picker — used to label the picker button.
  const selectedAddMemory = $derived(allMemories.find((m) => m.id === $addMemoryForm.memoryId));

  const profileActions = $derived.by(() => {
    const actions: NodeMenuAction[] = [];
    // Keep the existing org-only install route/audience.
    if (org) actions.push({ id: 'install', label: t('agent.actions.install', 'Install into app'), href: `/app/orgs/${encodeURIComponent(org.id)}/agents/install/${encodeURIComponent(agent.id)}` });
    // #1262: clone into an organization the caller administers. The eligible-org
    // list is a hint; the server's ADMIN gate on the target is authoritative.
    if (showCloneEntry({ visibility: agent.visibility, canManage: !!data.canManageAgent, eligibleCount: eligibleCloneTargets(navOrgs, data.currentUserId).length })) {
      actions.push({ id: 'clone', label: t('agent.actions.clone', 'Clone to organization'), href: `/app/agents/${encodeURIComponent(agent.id)}/clone` });
    }
    if (agent.systemMemoryId) actions.push({ id: 'conversations', label: t('agent.actions.conversations', 'Conversation editor'), href: `/app/agents/${encodeURIComponent(agent.id)}/conversations` });
    if (data.systemMemoryIdentity?.urn) actions.push({ id: 'system-memory', label: t('agent.actions.system-memory', 'Open system memory'), href: `/app/memories/${encodeURIComponent(data.systemMemoryIdentity.id)}` });
    return actions;
  });

  // ── Memories tab grid (#371 follow-up) ────────────────────────────────
  // The attached-memories list migrated from a hand-rolled card list to the
  // shared TanStack DataTable. Rows carry only what the cells render; the
  // role dropdown (?/updateMemoryRole) and Remove form (?/removeMemory) stay
  // inline in their cells, same pattern as the org memories grid.
  interface AgentMemoryRow {
    memoryId: string;
    name: string;
    urn: string;
    role: string;
  }

  const memoryRows = $derived<AgentMemoryRow[]>(
    (agent.memoryItems ?? []).map((item) => ({
      memoryId: item.memory.id,
      name: item.memory.name,
      urn: item.memory.urn,
      role: item.role,
    })),
  );

  // Role chip palette — preserves the green (read-write) / amber (read) chip
  // from the old card list.
  function roleChipClass(role: string): string {
    return role === 'read-write'
      ? '[border-color:rgb(134,239,172)] [background-color:rgb(240,253,244)] [color:rgb(21,128,61)] dark:[border-color:rgb(22,101,52)] dark:[background-color:rgb(20,83,45)] dark:[color:rgb(134,239,172)]'
      : '[border-color:rgb(252,211,77)] [background-color:rgb(255,251,235)] [color:rgb(180,83,9)] dark:[border-color:rgb(120,53,15)] dark:[background-color:rgb(69,26,3)] dark:[color:rgb(252,211,77)]';
  }

  let memoryFilter = $state('');

  const memoryColumns: PortalColumnDef<AgentMemoryRow>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 240 }, // identity column
    { accessorKey: 'urn', header: 'URN', size: 340 },
    { accessorKey: 'role', id: 'access', header: 'Access', size: 150 },
    // Removing the only Remove affordance via the column menu is a trap.
    { id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false, size: 80 },
  ];

  // ── Bundled agents grid (#713) ────────────────────────────────────────
  let bundledFilter = $state('');

  const bundledColumns: PortalColumnDef<BundledAgentRow>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: 'URN', size: 300 },
    { accessorKey: 'personaRole', id: 'role', header: 'Role', size: 160 },
    { accessorKey: 'via', header: 'Bundled via', size: 180 },
    { accessorKey: 'description', header: 'Description', size: 260 },
  ];

  const bundledTable = createSvelteTable<BundledAgentRow>({
    get data() {
      return bundledAgents;
    },
    columns: bundledColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return bundledFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      bundledFilter = typeof u === 'function' ? u(bundledFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  const memoryTable = createSvelteTable<AgentMemoryRow>({
    get data() {
      return memoryRows;
    },
    columns: memoryColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return memoryFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      memoryFilter = typeof u === 'function' ? u(memoryFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  // ── Apps tab grid (#472) ──────────────────────────────────────────────
  // The installed-Apps list on the shared TanStack DataTable. Rows come from
  // the loader's member-scoped `installedApps`; org names come from the
  // layout's already-authorized member orgs (`navOrgs`), never a new fetch.
  // The table pages the rows already loaded; the loader is not server-paged.
  interface AgentAppRow {
    id: string;
    name: string;
    urn: string;
    orgId: string | null;
    /** Null for a personal (org-less) App, or an org this user is not a member of. */
    orgName: string | null;
  }

  const navOrgs = $derived((data as { navOrgs?: OrgSummary[] }).navOrgs ?? []);
  const appRows = $derived.by<AgentAppRow[]>(() => {
    const names = new Map(navOrgs.map((o) => [o.id, o.name]));
    return installedApps.map((a) => ({
      id: a.id,
      name: a.name,
      urn: a.urn,
      orgId: a.orgId || null,
      orgName: a.orgId ? (names.get(a.orgId) ?? null) : null,
    }));
  });
  // Only orgs that own at least one of this agent's Apps can narrow the list.
  const appOrgOptions = $derived(navOrgs.filter((o) => appRows.some((a) => a.orgId === o.id)));
  let appOrgPick = $state<string | null>(null);
  // A pick whose org left the data (reload, another agent) is no filter at all.
  const appOrgFilter = $derived(appOrgPick && appOrgOptions.some((o) => o.id === appOrgPick) ? appOrgPick : null);
  const appOrgFilterName = $derived(appOrgOptions.find((o) => o.id === appOrgFilter)?.name ?? null);
  const visibleAppRows = $derived(appOrgFilter ? appRows.filter((a) => a.orgId === appOrgFilter) : appRows);
  let appsFilter = $state('');
  let appOrgPickerOpen = $state(false);

  function appOrgLabel(a: AgentAppRow): string {
    if (a.orgName) return a.orgName;
    return a.orgId
      ? t('agent.apps.org-unavailable', 'Organization not visible to you')
      : t('agent.apps.org-personal', 'Personal');
  }

  const appColumns: PortalColumnDef<AgentAppRow>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 240 }, // identity column
    { accessorKey: 'urn', header: 'URN', size: 340 },
    { accessorFn: (a) => appOrgLabel(a), id: 'org', header: 'Organization', size: 200 },
  ];

  const appsTable = createSvelteTable<AgentAppRow>({
    get data() {
      return visibleAppRows;
    },
    columns: appColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return appsFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      appsFilter = typeof u === 'function' ? u(appsFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  function pickAppOrg(o: OrgSummary | null) {
    appOrgPick = o?.id ?? null;
    appsTable.resetPageIndex();
  }

  // The page component is reused across /app/agents/[id] navigations; a filter
  // chosen on one agent must not carry to the next. Reads agent.id; the reset
  // itself is untracked (the table's reset reads and writes its own state).
  $effect(() => {
    void agent.id;
    untrack(() => {
      appOrgPick = null;
      appsFilter = '';
      appsTable.resetPageIndex();
    });
  });
</script>

<svelte:head><title>{agent.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Agents', href: agentsHref },
    { label: agent.name },
  ]} />

  <!-- Header -->
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white"><span class="text-zinc-400 font-normal">Agent:</span> {agent.name}</h1>
      <Urn value={agent.urn} type="agent" />
      {#if agent.description}
        <p class="mt-1 text-sm text-zinc-500">{agent.description}</p>
      {/if}
      {#if org}
        <p class="mt-1 text-xs text-zinc-400">Organization: {org.name}</p>
      {/if}
    </div>
    {#if profileActions.length > 0}
      <NodeActionsMenu label={t('agent.actions.label', 'Agent actions')} actions={profileActions} />
    {/if}
  </div>

  <!-- Tabs — #747: the third instance of the strip #746 fixed on the App detail
       page, and the one that gates a MemoryBrowser mount: the Nodes tab lives
       behind it, so the component being usable at phone widths is moot if the
       tab reaching it runs off the screen. Up to eight tabs here.
       `shrink-0 whitespace-nowrap` is what makes it SCROLL rather than squash
       the labels into unreadable columns. -->
  <div class="flex gap-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab}
      <button
        onclick={() => activeTab = tab.id}
        class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Action feedback lives at page level so it stays visible no matter which
       tab's form produced it (#352 split the agent / memory / delete forms
       across the Profile, Memories, and Settings tabs). -->
  {#if updateMemoryRoleActionError || removeMemoryActionError || deleteActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      {updateMemoryRoleActionError ?? removeMemoryActionError ?? deleteActionError}
    </div>
  {/if}
  {#if $agentSettingsMessage?.type === 'success' && !isEditing}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{$agentSettingsMessage.text}</div>
  {:else if addMemoryActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{addMemoryActionSuccess}</div>
  {:else if updateMemoryRoleActionSuccess || removeMemoryActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {updateMemoryRoleActionSuccess ?? removeMemoryActionSuccess}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- PROFILE TAB — info of this agent (#352)                             -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'tasks' && data.inheritance}
    <AgentDefinitions agentId={agent.id} read={data.inheritance.tasks} />
  {/if}
  {#if activeTab === 'processes' && data.inheritance}
    <AgentDefinitions agentId={agent.id} read={data.inheritance.processes} processes />
  {/if}
  {#if data.bootPromptForm}
    <div hidden={activeTab !== 'boot'}>
      {#key data.bootPromptForm.id}
        <BootPrompt canManage={data.canManageAgent} stored={agent.systemPrompt ?? ''} initial={data.bootPromptForm} submitted={bootPromptSubmission} />
      {/key}
    </div>
  {/if}
  {#if activeTab === 'profile'}
    {#if data.inheritance}
      <section class="mb-6 min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-label={t('agent.base.label', 'base Agent')}>
        <h2 class="mb-2 font-semibold">{t('agent.base.heading', 'Base Agent')}</h2>
        {#if data.inheritance.base.id}
          <a class="break-words text-indigo-600 hover:underline dark:text-indigo-400" href="/app/agents/{encodeURIComponent(data.inheritance.base.id)}">{data.inheritance.base.agent?.name ?? data.inheritance.base.id}</a>
          {#if data.inheritance.base.agent?.urn}<Urn value={data.inheritance.base.agent.urn} label={t('agent.base.label', 'base Agent')} linked />{/if}
          {#if !data.inheritance.base.agent && !data.inheritance.base.error}<p class="text-sm text-zinc-500">{t('agent.base.unavailable', 'Base Agent details are unavailable.')}</p>{/if}
        {:else if !data.inheritance.base.error}
          <p class="text-sm text-zinc-500">{t('agent.base.none', 'No base Agent.')}</p>
        {/if}
        {#if data.inheritance.base.error}<p role="alert" class="break-words text-sm text-red-600">{data.inheritance.base.error}</p>{/if}
      </section>
    {/if}
    <div class="space-y-8">

      <!-- Agent info (read-only). #352 follow-up: Profile is an info-only tab;
           the editable agent form lives on the Settings tab. -->
      <section class="max-w-lg">
        <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Agent</h2>
        <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Visibility</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">{visibilityLabel[agent.visibility]}</span>
          </div>
          {#if agent.description}
            <div class="px-5 py-3">
              <span class="text-sm text-zinc-500">Description</span>
              <p class="mt-1 text-sm text-zinc-900 dark:text-white">{agent.description}</p>
            </div>
          {/if}
          <!-- #974: persona DRESSING on a reusable role-actor. Not an identity —
               the named individual is a Worker cast into an App. -->
          {#if agent.personaRole}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">{t('agent.persona.role', 'Persona role')}</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{agent.personaRole}</span>
            </div>
          {/if}
          {#if data.systemMemoryIdentity?.urn}
            <div class="space-y-1 px-5 py-3">
              <span class="text-sm text-zinc-500">{t('agent.system-memory.label', 'Agent system memory')}</span>
              <div><Urn value={data.systemMemoryIdentity.urn} type="memory" linked label={t('agent.system-memory.label', 'Agent system memory')} /></div>
            </div>
          {/if}
          {#if org}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Organization</span>
              <span class="text-sm text-zinc-900 dark:text-white">{org.name}</span>
            </div>
          {/if}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Created</span>
            <span class="text-sm text-zinc-900 dark:text-white">{new Date(agent.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </section>

      <AgentExtendedBy agentId={agent.id} requestedAfter={data.extendedAfter ?? null} result={data.extendedBy ?? { items: [], endCursor: null, hasMore: false, failed: true }} />

      <!-- Capabilities — removed per FR-013 (spec 006-asset-upload-redesign).
           The v1 per-agent asset-upload toggle is being replaced by a per-
           memory acceptsUploads gate on the memory settings page (US3,
           landing in a follow-up PR). -->

      <!-- Properties -->
      {#if agent.properties}
        <section class="max-w-lg">
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Properties</h2>
          <pre class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{JSON.stringify(agent.properties, null, 2)}</pre>
        </section>
      {/if}

      <!-- Installation (008-agent-installation T068) -->
      {#if agent.memoryProvisioning || agent.installationPolicy || (agent.imports?.length ?? 0) > 0 || agent.appCount !== undefined}
        <section class="max-w-lg">
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Installation</h2>
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            {#if agent.memoryProvisioning}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">App memory</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{agent.memoryProvisioning.appMemory}</span>
              </div>
            {/if}
            {#if agent.installationPolicy}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Max members</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{agent.installationPolicy.maxMembers}</span>
              </div>
              <div class="px-5 py-3">
                <span class="text-sm text-zinc-500">Member roles</span>
                <p class="mt-1 text-sm text-zinc-900 dark:text-white">{agent.installationPolicy.memberRoles.join(', ') || '—'}</p>
              </div>
            {/if}
            {#if agent.appCount !== undefined}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Installed in</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{agent.appCount} {agent.appCount === 1 ? 'App' : 'Apps'}</span>
              </div>
            {/if}
            {#if (agent.imports?.length ?? 0) > 0}
              <div class="px-5 py-3">
                <span class="text-sm text-zinc-500">Imports</span>
                <ul class="mt-2 space-y-1">
                  {#each agent.imports ?? [] as imp (imp.importedAgentId)}
                    <li class="text-sm text-zinc-900 dark:text-white">
                      <span class="text-zinc-400">{imp.position}.</span>
                      <!-- hadron-server#1526: importedAgent is null when the viewer may not
                           read that Agent. The import still exists, so the row stays,
                           unlinked, since its page would refuse them anyway. -->
                      {#if imp.importedAgent}
                        <a href="/app/agents/{imp.importedAgentId}" class="text-indigo-500 hover:underline dark:text-indigo-400">{imp.importedAgent.name}</a>
                      {:else}
                        <span class="text-zinc-500 italic">{t('agent.imports.unreadable', 'An agent you can’t view')}</span>
                      {/if}
                      {#if imp.required}
                        <span class="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">required</span>
                      {:else}
                        <span class="ml-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">optional</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- MEMORIES TAB — memories attached to this agent (#352)               -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'memories'}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Memories
        <span class="ml-1 text-sm font-normal text-zinc-500">({(agent.memoryItems ?? []).length + (hasSystemMemory ? 1 : 0)})</span>
      </h2>

      {#if hasSystemMemory}
        <!-- The agent's own system memory — always attached, read-only, not
             reassignable/removable, so it renders as a fixed item rather than a
             table row. -->
        <div class="mb-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
          <span title="System memory — always attached, read-only" class="shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </span>
          <a href="/app/memories/{agent.systemMemoryId}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{systemMemory?.name ?? 'System memory'}</a>
          {#if systemMemory?.urn}<Urn value={systemMemory.urn} type="memory" size={10} />{/if}
          <span class="ml-auto shrink-0 rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">system · read-only</span>
        </div>
      {/if}

      {#if memoryRows.length > 0}
        <!-- 24rem offset tuned to this page's chrome (breadcrumb + header +
             tab bar above, Add-memory form below) — per-page convention. -->
        <div class="mb-4">
          <DataTable
            table={memoryTable}
            listKey="agent:memories"
            searchPlaceholder="Search memories..."
            searchAriaLabel="Search memories"
            bind:globalFilter={memoryFilter}
            maxHeight="max(200px, calc(100vh - 24rem))"
          >
            {#snippet cell(cell, m)}
              {#if cell.column.id === 'name'}
                <div class="flex min-w-0 items-center gap-1.5">
                  {#if m.role !== 'read-write'}
                    <span title="Read only" class="shrink-0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
                  {/if}
                  <a href="/app/memories/{m.memoryId}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
                </div>
              {:else if cell.column.id === 'urn'}
                <Urn value={m.urn} type="memory" size={10} />
              {:else if cell.column.id === 'access'}
                <form method="POST" action="?/updateMemoryRole" use:updateMemoryRoleEnhance class="flex items-center">
                  <input type="hidden" name="_kind" value="updateMemoryRole" />
                  <input type="hidden" name="memoryId" value={m.memoryId} />
                  <select name="role" value={m.role} data-memory-id={m.memoryId} onchange={submitMemoryRoleChange} disabled={$updateMemoryRoleSubmitting} class="rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 {roleChipClass(m.role)}">
                    <option value="read">read</option>
                    <option value="read-write">read-write</option>
                  </select>
                </form>
              {:else if cell.column.id === 'actions'}
                <NodeActionsMenu
                  actions={[{ id: 'remove', label: 'Remove', danger: true }]}
                  onselect={(id) => { if (id === 'remove') removeMemory(m.memoryId); }}
                  label={`Actions for ${m.name}`}
                  disabled={$removeMemorySubmitting}
                  fixed
                  compact
                />
              {/if}
            {/snippet}
          </DataTable>
          <form bind:this={removeMemoryFormEl} method="POST" action="?/removeMemory" use:removeMemoryEnhance class="hidden">
            <input type="hidden" name="_kind" value="removeMemory" />
            <input type="hidden" name="memoryId" value={$removeMemoryForm.memoryId} />
          </form>
        </div>
      {:else}
        <p class="mb-4 text-sm text-zinc-500">No memories in this agent.</p>
      {/if}

      {#if availableMemories.length > 0}
        <form method="POST" action="?/addMemory" use:addMemoryEnhance class="space-y-2" novalidate>
          <input type="hidden" name="_kind" value={$addMemoryForm._kind} />
          <div class="flex items-end gap-3">
          <div class="flex-1 max-w-md">
            <div id="agent-add-memory-label" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Add memory</div>
            <div class="flex gap-2">
              <button
                type="button"
                aria-describedby={addMemoryError ? 'agentAddMemoryError' : 'agent-add-memory-label'}
                onclick={() => selectMemoryOpen = true}
                class="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 {addMemoryError ? 'border-red-500' : ''}"
              >
                {#if $addMemoryForm.memoryId}
                  {selectedAddMemory?.name ?? 'Select a memory'}
                {:else}
                  Select a memory
                {/if}
              </button>
              <input type="hidden" name="memoryId" value={$addMemoryForm.memoryId} />
            </div>
            {#if addMemoryError}
              <p id="agentAddMemoryError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{addMemoryError}</p>
            {/if}
            {#if addMemoryActionError}
              <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{addMemoryActionError}</p>
            {/if}
          </div>
          <div>
            <label for="memRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
            <select id="memRole" name="role" bind:value={$addMemoryForm.role} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="read">Read</option>
              <option value="read-write">Read/Write</option>
            </select>
          </div>
          <button type="submit" disabled={!$addMemoryForm.memoryId || $addMemorySubmitting} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50">
            {$addMemorySubmitting ? 'Adding...' : 'Add'}
          </button>
          </div>
        </form>
      {:else if allMemories.length === 0}
        <p class="text-xs text-zinc-500">No memories available. Create a memory first.</p>
      {:else}
        <p class="text-xs text-zinc-500">All available memories are already in this agent.</p>
      {/if}
    </section>
  {/if}

  <!-- SelectMemory modal -->
  <SelectMemory
    memories={availableMemories}
    bind:open={selectMemoryOpen}
    onselect={(memory) => {
      addMemoryForm.update((current) => ({ ...current, memoryId: memory.id }));
    }}
  />

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- APPS TAB — apps this agent is installed into (via the AppAgent join) -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'apps'}
    <section>
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="font-semibold text-zinc-900 dark:text-white">Apps
          <span class="ml-1 text-sm font-normal text-zinc-500">({installedApps.length})</span>
        </h2>
        <!-- #648: a user-owned (org-less) agent installs as a PERSONAL app via
             the org-less create flow (org agents install from the org grid). -->
        {#if !agent.organizationId}
          <a
            href="/app/apps/new?agent={agent.id}"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style="background: #fb8500;"
          >Install as app</a>
        {/if}
      </div>
      {#if installedAppsError}
        <p role="alert" class="mb-3 text-sm text-red-600 dark:text-red-400">
          {installedApps.length > 0
            ? t('agent.apps.error-partial', 'Part of the Apps list could not be loaded, so this list may be incomplete. Reload to try again.')
            : t('agent.apps.error', 'The Apps list could not be loaded. Reload to try again.')}
        </p>
      {/if}
      {#if installedApps.length > 0}
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={() => (appOrgPickerOpen = true)}
            aria-haspopup="dialog"
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >{t('agent.apps.org-filter', 'Organization')}: {appOrgFilterName ?? t('agent.apps.org-all', 'All organizations')}</button>
          {#if appOrgFilter}
            <button
              type="button"
              onclick={() => pickAppOrg(null)}
              class="rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
            >{t('agent.apps.org-clear', 'Clear')}</button>
          {/if}
        </div>
        <SelectOrg orgs={appOrgOptions} bind:open={appOrgPickerOpen} onselect={pickAppOrg} />
        <DataTable
          table={appsTable}
          listKey="agent:apps"
          searchPlaceholder="Search apps..."
          searchAriaLabel="Search apps"
          bind:globalFilter={appsFilter}
          maxHeight="max(200px, calc(100vh - 20rem))"
        >
          {#snippet cell(cell, a)}
            {#if cell.column.id === 'name'}
              <a href="/app/apps/{a.id}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{a.name}</a>
            {:else if cell.column.id === 'urn'}
              <Urn value={a.urn} type="app" size={10} />
            {:else if cell.column.id === 'org'}
              <span class="truncate {a.orgName ? '' : 'text-zinc-500'}">{appOrgLabel(a)}</span>
            {/if}
          {/snippet}
        </DataTable>
      {:else if !installedAppsError}
        <p class="text-sm text-zinc-500">This agent isn't installed into any apps yet.</p>
      {/if}
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- BUNDLED AGENTS TAB — agents this one carries with it (#713)          -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'bundled'}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Bundled agents
        <span class="ml-1 text-sm font-normal text-zinc-500">({bundledAgents.length})</span>
      </h2>
      <!-- #1173: bundle another agent (an AgentImport edge). The server decides
           who may and what is legal; its sentence is shown as is. -->
      {#if bundleCandidatesError}
        <p role="alert" class="mb-3 text-sm text-red-600 dark:text-red-400">
          {t('agent.bundled.add.unavailable', 'The list of agents you can bundle could not be loaded. Reload to try again.')}
        </p>
      {:else if bundleCandidates.length > 0}
        <form
          method="POST"
          action="?/addBundledAgent"
          class="mb-4 flex flex-wrap items-end gap-3"
          use:enhance={() => {
            bundling = true;
            return async ({ update }) => {
              await update();
              bundling = false;
            };
          }}
        >
          <input type="hidden" name="position" value={nextImportPosition} />
          <div class="min-w-[220px] flex-1">
            <label for="bundleAgentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('agent.bundled.add.label', 'Add a bundled agent')}</label>
            <select id="bundleAgentId" name="agentId" required class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="">{t('agent.bundled.add.placeholder', 'Select an agent…')}</option>
              {#each bundleCandidates as c (c.id)}
                <option value={c.id}>{c.name} — {c.urn}</option>
              {/each}
            </select>
          </div>
          <label class="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" name="required" checked />
            {t('agent.bundled.add.required', 'Required')}
          </label>
          <button type="submit" disabled={bundling} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
            {bundling ? t('agent.bundled.add.adding', 'Adding…') : t('agent.bundled.add.submit', 'Add')}
          </button>
        </form>
      {:else if org}
        <p class="mb-3 text-sm text-zinc-500">
          {t('agent.bundled.add.none', 'No agent is available to bundle. Only agents your organization has an active license for can be bundled.')}
        </p>
      {/if}
      {#if bundleResult?.bundleError}
        <p role="alert" class="mb-3 text-sm text-red-600 dark:text-red-400">{bundleResult.bundleError}</p>
      {:else if bundleResult?.bundleAdded}
        <p role="status" class="mb-3 text-sm text-green-700 dark:text-green-400">{t('agent.bundled.add.done', 'Agent bundled.')}</p>
      {/if}
      {#if bundledMayBeIncomplete}
        <p role="status" class="mb-3 text-xs text-zinc-500">
          {t('agent.bundled.withheld', 'This list may be incomplete because some installed agents aren’t visible to you.')}
        </p>
      {/if}
      <!-- 24rem offset tuned to this page's chrome (breadcrumb + header + tab
           bar above) — per-page convention, same as the Memories grid. -->
      <DataTable
        table={bundledTable}
        listKey="agent:bundled-agents"
        searchPlaceholder="Search bundled agents..."
        searchAriaLabel="Search bundled agents"
        bind:globalFilter={bundledFilter}
        maxHeight="max(200px, calc(100vh - 24rem))"
      >
        {#snippet cell(cell, a)}
          {#if cell.column.id === 'name'}
            <a href="/app/agents/{a.id}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{a.name}</a>
          {:else if cell.column.id === 'urn'}
            <Urn value={a.urn} type="agent" size={10} />
          {:else if cell.column.id === 'role'}
            <span class="text-sm text-zinc-600 dark:text-zinc-400">{a.personaRole ?? '—'}</span>
          {:else if cell.column.id === 'via'}
            <span class="text-sm text-zinc-600 dark:text-zinc-400">{a.via}</span>
          {:else if cell.column.id === 'description'}
            <span class="min-w-0 truncate text-sm text-zinc-600 dark:text-zinc-400" title={a.description ?? ''}>{a.description ?? '—'}</span>
          {/if}
        {/snippet}
      </DataTable>
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- NODES TAB — browse the agent's memory nodes (was "Memory") (#352)   -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'nodes'}
    {#if data.agentNodesError}
      <p role="alert" class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t('agent.nodes.load-failed', 'Could not load this agent’s nodes, so the list below may be incomplete. Reload to try again.')}
      </p>
    {/if}
    <MemoryBrowser nodes={data.agentNodes ?? []} multiMemory={(agent.memoryItems ?? []).length > 1} {writableMemoryIds} scopeMemoryIds={(agent.memoryItems ?? []).map((item) => item.memory.id)} />
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- CHATBOT CONTROL TAB                                               -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'chatbot' && hasSystemMemory}
    <div class="space-y-4">
      <!-- Sub-tab bar -->
      <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {#each openSubTabs as subTab (subTab.id)}
          <div class="flex items-center">
            <button
              onclick={() => activeSubTab = subTab.id}
              class="border-b-2 px-3 py-1.5 text-sm font-medium transition
                {activeSubTab === subTab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}"
            >
              {subTab.label}
            </button>
            {#if subTab.id !== 'index'}
              <button onclick={() => closeSubTab(subTab.id)}
                class="ml-0.5 rounded px-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="Close tab"
              >×</button>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Sub-tab: Overview (conversations + partials) -->
      {#if activeSubTab === 'index'}
        <div class="space-y-6">
          <section>
            <div class="mb-3 flex items-center justify-between">
              <h2 class="font-semibold text-zinc-900 dark:text-white">Conversations</h2>
              <div class="flex items-center gap-4">
                <a href="/app/agents/{agent.id}/test"
                  class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                  Open Tester →
                </a>
                <a href="/app/agents/{agent.id}/conversations"
                  class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                  Open conversation editor →
                </a>
              </div>
            </div>
            <NodeTable
              nodes={conversationRows}
              searchPlaceholder="Search conversations..."
              emptyLabel="No conversations yet. Use the conversation editor to add one."
              onselect={(row) => openConversationTab(row.loc, row.name)}
            />
          </section>

          <section>
            <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Partials</h2>
            <NodeTable
              nodes={partialRows}
              searchPlaceholder="Search partials..."
              emptyLabel="No partials yet."
              onselect={(row) => openPartialTab(row.loc, row.name)}
            />
          </section>
        </div>
      {/if}

      <!-- Sub-tab: Conversation (stages list) -->
      {#each openSubTabs as subTab (subTab.id)}
        {#if subTab.id === activeSubTab && subTab.id.startsWith('conv:') && subTab.loc}
          {@const convLoc = subTab.loc}
          {@const conv = nodeAtLoc(convLoc)}
          <div class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">
                <span class="text-zinc-400 font-normal">Conversation:</span> {conv?.name ?? convLoc}
              </h2>
              {#if conv}
                <div class="mt-1"><Urn value={systemMemoryUrn && conv.loc ? composeNodeUrn(systemMemoryUrn, conv.loc) : conv.loc} type="node" /></div>
                {#if conv.description}
                  <p class="mt-1 text-sm text-zinc-500">{conv.description}</p>
                {/if}
                {@const convData = (conv.data as Record<string, unknown>) ?? {}}
                {@const goals = Array.isArray(convData.goalDescriptions) ? convData.goalDescriptions : []}
                {@const signals = Array.isArray(convData.goalSignals) ? convData.goalSignals : []}
                {#if goals.length}
                  <div class="mt-2">
                    <span class="text-xs font-medium text-zinc-500">Goals:</span>
                    <ul class="mt-1 space-y-0.5">
                      {#each goals as goal}
                        <li class="text-xs text-zinc-600 dark:text-zinc-400">- {goal}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if signals.length}
                  <div class="mt-1">
                    <span class="text-xs font-medium text-zinc-500">Signals:</span>
                    <span class="text-xs text-zinc-400">{signals.join(', ')}</span>
                  </div>
                {/if}
              {/if}
            </div>

            <section>
              <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">Stages</h3>
              <NodeTable
                nodes={stageRowsFor(convLoc)}
                searchPlaceholder="Search stages..."
                emptyLabel="No stages yet."
                onselect={(row) => {
                  // Stages open in the node detail page since they have their
                  // own rich editing (content, data, edges, etc.)
                  const memId = agent.systemMemoryId;
                  if (memId) {
                    window.location.href = `/app/memories/${memId}/nodes/${row.id}`;
                  }
                }}
              />
            </section>

            <p class="text-xs text-zinc-400">
              For inline prompt and extraction-spec editing, use the
              <a href="/app/agents/{agent.id}/conversations" class="text-indigo-500 hover:underline">full conversation editor</a>.
            </p>
          </div>
        {/if}
      {/each}

      <!-- Sub-tab: Partial -->
      {#each openSubTabs as subTab (subTab.id)}
        {#if subTab.id === activeSubTab && subTab.id.startsWith('partial:') && subTab.loc}
          {@const partialLoc = subTab.loc}
          {@const partial = nodeAtLoc(partialLoc)}
          <div class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">
                <span class="text-zinc-400 font-normal">Partial:</span> {partial?.name ?? partialLoc}
              </h2>
              {#if partial}
                <div class="mt-1"><Urn value={systemMemoryUrn && partial.loc ? composeNodeUrn(systemMemoryUrn, partial.loc) : partial.loc} type="node" /></div>
                {#if partial.description}
                  <p class="mt-1 text-sm text-zinc-500">{partial.description}</p>
                {/if}
              {/if}
            </div>

            {#if partial?.content}
              <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <pre class="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">{partial.content}</pre>
              </div>
            {:else}
              <p class="text-sm text-zinc-400">No content.</p>
            {/if}

            {#if partial}
              <p class="text-xs text-zinc-400">
                <a href="/app/memories/{agent.systemMemoryId}/nodes/{partial.id}"
                  class="text-indigo-500 hover:underline">Edit this partial →</a>
              </p>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- AI PROVIDERS TAB — agent-owned AI service configs (#352)            -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'ai'}
    <!-- The agent's `default` config is one level of the resolution walk used
         when the agent runs inside an App. -->
    <section class="max-w-2xl">
      <AiServiceConfigSection
        ownerType="AGENT"
        ownerId={agent.id}
        configs={data.agentConfigs ?? []}
        members={org?.members ?? []}
        currentUserId={data.currentUserId}
        configsError={data.configsError}
      />
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETTINGS TAB — the rest (#352)                                      -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'settings'}
    {#if data.inheritanceManagement}
      <AgentInheritanceSettings management={data.inheritanceManagement} currentBase={data.inheritance.base} candidates={data.baseCandidates} baseForm={data.baseForm} indexRefsForm={data.indexRefsForm} actionData={form} />
    {/if}
    <div class="space-y-8">
      <!-- Agent settings (editable). #352 follow-up: the editable agent form
           lives here; the Profile tab shows the same info read-only. -->
      <section class="max-w-lg">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">Agent</h2>
          {#if !isEditing}
            <button onclick={openEdit} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
          {/if}
        </div>

        {#if isEditing}
          <form method="POST" action="?/update" use:agentSettingsEnhance
            class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
            <input type="hidden" name="_kind" value={$agentSettingsForm._kind} />
            {#if agentSettingsActionError}
              <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{agentSettingsActionError}</div>
            {/if}
            <div>
              <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input id="editName" name="name" type="text" bind:value={$agentSettingsForm.name}
                aria-invalid={!!agentNameError}
                aria-describedby={agentNameError ? 'editNameError' : undefined}
                {...$agentSettingsConstraints.name}
                class="{inputClass} {agentNameError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if agentNameError}
                <p id="editNameError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{agentNameError}</p>
              {/if}
            </div>
            <div>
              <label for="editUrn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <div class="flex items-stretch">
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{urnPrefix}:</span>
                <input id="editUrn" name="urnSlug" type="text" bind:value={$agentSettingsForm.urnSlug}
                  aria-invalid={!!agentUrnError}
                  aria-describedby={agentUrnError ? 'editUrnError' : undefined}
                  {...$agentSettingsConstraints.urnSlug}
                  class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {agentUrnError ? 'border-red-500 focus:border-red-500' : ''}" />
              </div>
              {#if agentUrnError}
                <p id="editUrnError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{agentUrnError}</p>
              {/if}
            </div>
            <div>
              <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <textarea id="editDescription" name="description" rows="3" placeholder="What this agent is for" bind:value={$agentSettingsForm.description} class={inputClass}></textarea>
            </div>
            <div>
              <label for="editVisibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
              <select id="editVisibility" name="visibility" bind:value={$agentSettingsForm.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="PERSONAL">Personal</option>
                <!-- ORGANIZATION visibility needs an org — hidden for a user-owned agent (#636). -->
                {#if org}
                  <option value="ORGANIZATION">Organization</option>
                {/if}
                <option value="PUBLIC">Public</option>
              </select>
            </div>
            {#if agent.systemMemoryId}
              <!-- #488: once attached, the server forbids changing/unsetting the
                   system memory, so there is no control here at all — #711 turned
                   the old disabled text input (which only ever showed the name)
                   into the memory itself: a hotlink to the memory page plus its
                   URN chip. No <label> without a control: the field heading is a
                   plain <div> so nothing dangles a `for=` at a missing input. -->
              <div>
                <div class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Agent system memory</div>
                <div class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                  <a href="/app/memories/{agent.systemMemoryId}" class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                    {systemMemory?.name ?? 'System memory'}
                  </a>
                  {#if systemMemory?.urn}
                    <div class="mt-1"><Urn value={systemMemory.urn} type="memory" size={10} linked /></div>
                  {/if}
                </div>
                <p class="mt-1 text-xs text-zinc-400">The agent system memory is like an operating system. Unless you are the agent builder, don't edit it.</p>
              </div>
            {:else}
              <div>
                <label for="editSystemMemoryId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Agent system memory <span class="text-zinc-500">(for conversations, automations, and more)</span></label>
                <select id="editSystemMemoryId" name="systemMemoryId" bind:value={$agentSettingsForm.systemMemoryId} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="">— None —</option>
                  {#each orgSystemMemories as sm}
                    <option value={sm.id}>{sm.name} ({sm.urn})</option>
                  {/each}
                </select>
                <p class="mt-1 text-xs text-zinc-400">Memory the agent uses for conversations, automations, and other tasks.</p>
              </div>
            {/if}
            <!-- The role belongs to the reusable Agent; the shared template
                 now lives in systemPrompt (#1241). -->
            <div>
              <label for="editPersonaRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('agent.persona.role', 'Persona role')}</label>
              <input id="editPersonaRole" name="personaRole" type="text" placeholder="backend-engineer" bind:value={$agentSettingsForm.personaRole}
                aria-describedby="editPersonaRoleHelp" class={inputClass} />
              <p id="editPersonaRoleHelp" class="mt-1 text-xs text-zinc-400">{t('agent.persona.role.help', 'Free-form role, by convention a slug like backend-engineer. Casting an agent into an App defaults the worker’s role to this.')}</p>
            </div>
            <div class="flex gap-3">
              <button type="submit" disabled={$agentSettingsSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">{$agentSettingsSubmitting ? 'Saving...' : 'Save'}</button>
              <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
            </div>
          </form>
        {:else}
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Visibility</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{visibilityLabel[agent.visibility]}</span>
            </div>
            {#if agent.description}
              <div class="px-5 py-3">
                <span class="text-sm text-zinc-500">Description</span>
                <p class="mt-1 text-sm text-zinc-900 dark:text-white">{agent.description}</p>
              </div>
            {/if}
            {#if agent.personaRole}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">{t('agent.persona.role', 'Persona role')}</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{agent.personaRole}</span>
              </div>
            {/if}
            {#if agent.systemMemoryId}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Agent system memory</span>
                <a href="/app/memories/{agent.systemMemoryId}" class="text-sm font-medium text-indigo-500 hover:underline dark:text-indigo-400">{systemMemory?.name ?? 'System memory'} →</a>
              </div>
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Conversations</span>
                <a href="/app/agents/{agent.id}/conversations" class="text-sm font-medium text-indigo-500 hover:underline dark:text-indigo-400">Conversation Editor →</a>
              </div>
            {/if}
            {#if org}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Organization</span>
                <span class="text-sm text-zinc-900 dark:text-white">{org.name}</span>
              </div>
            {/if}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Created</span>
              <span class="text-sm text-zinc-900 dark:text-white">{new Date(agent.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        {/if}
      </section>

      <!-- portal#1142 S8: the Agent's boot-prompt pointer (hadron-server#2219).
           Its own form and action, so it never rides along with the Agent form. -->
      <section class="max-w-lg" aria-labelledby="bootPointerHeading">
        <h2 id="bootPointerHeading" class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('boot-pointer.agent.heading', 'Boot prompt pointer')}</h2>
        <!-- Re-keyed per Agent: the page component is reused across /agents/A → B,
             and a draft typed for A must never sit in B's form (George, #1246). -->
        {#key data.agent.id}
          <BootPromptPointer
            read={data.bootPointer}
            canManage={data.canManageAgent}
            action="?/setBootPrompt"
            result={pointerResultFor((form as { pointer?: PointerResult } | null)?.pointer, data.bootPointerKey)}
            idPrefix="agent-boot-pointer"
          />
        {/key}
      </section>

      <!-- #942: how this agent starts out in an App's default channel. Saved on
           its own (only registerDefaults is sent), so it never rides along
           with, or blocks, the Agent form above. -->
      <section class="max-w-lg" aria-labelledby="registerDefaultsHeading">
        <h2 id="registerDefaultsHeading" class="mb-2 font-semibold text-zinc-900 dark:text-white">{t('agent.register-defaults.heading', 'Channel attendance')}</h2>
        <p class="mb-3 text-sm text-zinc-500">{t('agent.register-defaults.help', 'When this agent is installed into an App, it’s added to the App’s default channel. This sets what counts as new for it there. It applies only to attendance created from now on. Existing attendance is edited on each App’s Channels page. Attendance never gives access to a channel’s memory.')}</p>
        {#if data.registerDefaults === null}
          <p role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">{t('agent.register-defaults.load-failed', 'The current setting could not be loaded. Reload the page to try again.')}</p>
        {:else}
          <form method="POST" action="?/updateRegisterDefaults" use:registerDefaultsEnhance novalidate
            class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <input type="hidden" name="_kind" value={$registerDefaultsForm._kind} />
            <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" name="mentionOnly" bind:checked={$registerDefaultsForm.mentionOnly} onchange={clearSavedBanner} class="mt-0.5" aria-describedby="registerDefaultsMentionHelp" />
              <span>
                {t('app.channels.register.mentions.only', 'Only when mentioned')}
                <span id="registerDefaultsMentionHelp" class="block text-xs text-zinc-500">{$registerDefaultsForm.mentionOnly
                  ? t('agent.register-defaults.mention-only.on', 'New installs count only messages that mention this agent.')
                  : t('agent.register-defaults.mention-only.off', 'New installs count every message in the default channel.')}</span>
              </span>
            </label>
            {#if registerDefaultsError}
              <p role="alert" class="text-sm text-red-600 dark:text-red-400">{registerDefaultsError}</p>
            {:else if registerDefaultsSuccess}
              <p role="status" class="text-sm text-emerald-600 dark:text-emerald-400">{registerDefaultsSuccess}</p>
            {/if}
            <button type="submit" disabled={$registerDefaultsSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
              {$registerDefaultsSubmitting ? t('agent.register-defaults.saving', 'Saving…') : t('agent.register-defaults.save', 'Save')}
            </button>
          </form>
        {/if}
      </section>

      <!-- Danger zone -->
      <section class="max-w-lg">
        <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
        {#if !confirmDelete}
          <button onclick={() => confirmDelete = true} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
            Delete agent
          </button>
        {:else}
          <form method="POST" action="?/delete" use:deleteEnhance class="flex items-center gap-2" novalidate>
            <input type="hidden" name="_kind" value={$deleteForm._kind} />
            <span class="text-sm text-red-500">Delete "{agent.name}"? This cannot be undone.</span>
            <button type="submit" disabled={$deleteSubmitting} class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
              {$deleteSubmitting ? 'Deleting...' : 'Yes, delete'}
            </button>
            <button type="button" onclick={() => confirmDelete = false} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
          </form>
        {/if}
      </section>
    </div>
  {/if}
</div>
