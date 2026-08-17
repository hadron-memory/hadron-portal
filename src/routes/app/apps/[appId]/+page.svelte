<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import JSZip from 'jszip';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import AgentChat from '$lib/components/AgentChat.svelte';
  import TeamChatThread from '$lib/components/TeamChatThread.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import { chooseAppChatTabRender } from '$lib/components/app-chat-tab.js';
  import { hasChatSurface as hasChatSurfaceFn } from '$lib/app-surfaces';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t.js';
  import hadronInstructions from '$lib/assets/hadron-instructions.md?raw';
  import type { PageData, ActionData } from './$types';
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
  type AddAgentSuperform = SuperValidated<AddAgentForm, App.Superforms.Message, AddAgentForm>;
  type AppSettingsSuperform = SuperValidated<AppSettingsForm, App.Superforms.Message, AppSettingsForm>;
  type CastWorkerSuperform = SuperValidated<CastWorkerForm, App.Superforms.Message, CastWorkerForm>;
  type CreateAppKeySuperform = SuperValidated<CreateAppKeyForm, App.Superforms.Message, CreateAppKeyForm>;
  type DeleteAppSuperform = SuperValidated<DeleteAppForm, App.Superforms.Message, DeleteAppForm>;
  type RemoveAppAgentSuperform = SuperValidated<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>;
  type RetireWorkerSuperform = SuperValidated<RetireWorkerForm, App.Superforms.Message, RetireWorkerForm>;
  type RevokeAppKeySuperform = SuperValidated<RevokeAppKeyForm, App.Superforms.Message, RevokeAppKeyForm>;
  type UpdateAppAgentToolsSuperform = SuperValidated<UpdateAppAgentToolsForm, App.Superforms.Message, UpdateAppAgentToolsForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const availableAgents = $derived(data.availableAgents);

  // ── Staff (#974) ─────────────────────────────────────────────────────
  // The App's STAFF are its Workers — the named castings. `App.agents` is only
  // the install ROSTER: which role-actors are available to cast. Two different
  // lists, deliberately kept apart.
  //
  // null = the fetch failed, which is NOT the same as "no staff" — the empty
  // state must not claim an App has no workers when we simply couldn't ask.
  const staff = $derived(data.staff);
  const staffError = $derived(data.staffError);
  // Active first, then retired (a retired worker still holds its name forever,
  // so it belongs in the list — just not at the top).
  const sortedStaff = $derived(
    [...(staff ?? [])].sort((a, b) => {
      if (!!a.retiredAt !== !!b.retiredAt) return a.retiredAt ? 1 : -1;
      return a.name.localeCompare(b.name);
    }),
  );
  // Castable = the App's install roster. castWorker refuses an agent that isn't
  // installed (WORKER_AGENT_NOT_INSTALLED), so offering anything else would be
  // offering a guaranteed failure.
  const castableAgents = $derived(app.agents ?? []);
  let castOpen = $state(false);
  // #648: this page is canonical org-optional — an org-owned app renders its org
  // chrome, a user-owned (org-less) app does not. The "Apps" list this app
  // belongs to is the org grid for an org app, the personal "My apps" list for a
  // user-owned one; the URN prefix is the org URN for an org app, else derived
  // from the app's own URN (everything before the final ':' slug segment).
  const appsHref = $derived(org ? `/app/orgs/${org.id}/apps` : '/app/apps');
  const urnPrefix = $derived(
    org ? org.urn : app.urn.slice(0, Math.max(0, app.urn.lastIndexOf(':'))),
  );

  // ── Tab state — driven by App.surfaces (008-agent-installation T071) ─
  // The chat tab appears iff the App's `surfaces` array contains 'chat'.
  // Pre-008 this was gated on `app.appType === 'CHATBOT'`; 008's migration
  // sets `surfaces = ['chat']` for chatbot Apps so existing apps keep their
  // tab without behavior change. Gate logic lives in `$lib/app-surfaces`
  // so it's unit-testable independent of the Svelte component lifecycle.
  type TabId = 'chat' | 'team-chat' | 'staff' | 'memory' | 'settings' | 'client';
  const hasChatSurface = $derived(hasChatSurfaceFn(app.surfaces));
  // Chat tab renders the agent-chat platform when an Agent is linked;
  // shows an empty state otherwise.
  // 036-ai-service-config: configs resolvable for this app's chat context
  // (App→Agent→Org→Host, masked). Powers the picker + LLM-readiness gate.
  const usableChatConfigs = $derived((data.chatConfigs ?? []).filter((c) => c.hasApiKey));
  // null chatConfigs = couldn't list (e.g. viewer isn't an App member) →
  // unknown → don't block the chat.
  const llmReady = $derived(data.chatConfigs === null ? null : usableChatConfigs.length > 0);
  const appChatRender = $derived(
    chooseAppChatTabRender({ surfaces: app.surfaces, agentId: app.agentId, llmReady }),
  );
  // Picker selection overlaid on the default (`default`, else first usable).
  let selectedConfigName = $state<string | null>(null);
  // Validate the pick against the (possibly refreshed) usable set: if the
  // selected config was deleted/disabled — e.g. edited in Settings, then back
  // to Chat where invalidateAll refetched chatConfigs — fall back to
  // default → first rather than sending a name that no longer resolves.
  const effectiveConfigName = $derived(
    selectedConfigName && usableChatConfigs.some((c) => c.name === selectedConfigName)
      ? selectedConfigName
      : (usableChatConfigs.find((c) => c.name === 'default')?.name
          ?? usableChatConfigs[0]?.name
          ?? null),
  );
  let activeTab = $state<TabId>(untrack(() => hasChatSurface ? 'chat' : 'memory'));
  const tabs = $derived<{ id: TabId; label: string }[]>([
    ...(hasChatSurface ? [{ id: 'chat' as TabId, label: 'Chat' }] : []),
    // #732: the App's TEAM CHAT — a different thing from the Chat tab above,
    // which is an agent chat session. Always present, for the same reason as
    // Staff below: an App with no team chat yet is information, and the tab is
    // how the first message gets posted. The label keeps "team" on it always,
    // because a bare "Chat" next to the tab above is exactly the collision the
    // ratified vocabulary exists to prevent (hadron-server#1034).
    { id: 'team-chat', label: t('app.tabs.team-chat', 'Team chat') },
    // #974: the App's staff — its Workers. Always present, including when the
    // staff list is empty: "this App has no workers cast yet" is information,
    // and hiding the tab would hide the way to cast the first one.
    { id: 'staff', label: t('app.tabs.staff', 'Staff') },
    { id: 'memory', label: 'Memory' },
    { id: 'settings', label: 'Settings' },
    ...(!hasChatSurface ? [{ id: 'client' as TabId, label: 'Client' }] : []),
  ]);
  $effect(() => {
    const current = untrack(() => activeTab);
    if (!tabs.some((tab) => tab.id === current)) activeTab = tabs[0]?.id ?? 'memory';
  });

  // URN slug helpers — slug is the part after the org URN's prefix.
  function slugOfUrn(urn: string): string {
    // The app slug is the LAST ':'-segment. `App.urn` is server-canonicalized
    // (e.g. `hrn:app:<org>::<slug>` / `<org>::<slug>`), so slicing after the
    // FIRST colon captured the `app:`/`<org>::` prefix — which updateApp then
    // slugified INTO the stored slug, prepending a garbage `app-<org>-` layer on
    // every save (the app-…-app-…-agent-… URN corruption that 404'd the page).
    const idx = urn.lastIndexOf(':');
    return idx >= 0 ? urn.slice(idx + 1) : urn;
  }

  // ── Settings edit state ──────────────────────────────────────────────
  let editMode = $state(false);

  const initialAppSettingsForm = untrack(() => submittedForm<AppSettingsForm>(form, 'updateApp') as AppSettingsSuperform | null ?? data.appSettingsForm);
  const {
    form: appSettingsForm,
    errors: appSettingsErrors,
    constraints: appSettingsConstraints,
    message: appSettingsMessage,
    submitting: appSettingsSubmitting,
    enhance: appSettingsEnhance,
  } = superForm<AppSettingsForm, App.Superforms.Message, AppSettingsForm>(initialAppSettingsForm, {
    validators: zod4Client(appSettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') editMode = false;
    },
  });

  const initialAddAgentForm = untrack(() => submittedForm<AddAgentForm>(form, 'addAgent') as AddAgentSuperform | null ?? data.addAgentForm);
  const {
    form: addAgentForm,
    errors: addAgentErrors,
    message: addAgentMessage,
    submitting: addAgentSubmitting,
    enhance: addAgentEnhance,
  } = superForm<AddAgentForm, App.Superforms.Message, AddAgentForm>(initialAddAgentForm, {
    validators: zod4Client(addAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialCreateKeyForm = untrack(() => submittedForm<CreateAppKeyForm>(form, 'createKey') as CreateAppKeySuperform | null ?? data.createKeyForm);
  const {
    form: createKeyForm,
    message: createKeyMessage,
    submitting: createKeySubmitting,
    enhance: createKeyEnhance,
  } = superForm<CreateAppKeyForm, App.Superforms.Message, CreateAppKeyForm>(initialCreateKeyForm, {
    validators: zod4Client(createAppKeySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') createKeyForm.update((current) => ({ ...current, label: '' }), { taint: false });
    },
  });

  const initialRemoveAgentForm = untrack(() => submittedForm<RemoveAppAgentForm>(form, 'removeAgent') as RemoveAppAgentSuperform | null ?? data.removeAgentForm);
  const {
    form: removeAgentForm,
    errors: removeAgentErrors,
    message: removeAgentMessage,
    submitting: removeAgentSubmitting,
    enhance: removeAgentEnhance,
  } = superForm<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>(initialRemoveAgentForm, {
    validators: zod4Client(removeAppAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialUpdateAgentToolsForm = untrack(() => submittedForm<UpdateAppAgentToolsForm>(form, 'updateAgentTools') as UpdateAppAgentToolsSuperform | null ?? data.updateAgentToolsForm);
  const {
    form: updateAgentToolsForm,
    errors: updateAgentToolsErrors,
    message: updateAgentToolsMessage,
    enhance: updateAgentToolsEnhance,
  } = superForm<UpdateAppAgentToolsForm, App.Superforms.Message, UpdateAppAgentToolsForm>(initialUpdateAgentToolsForm, {
    validators: zod4Client(updateAppAgentToolsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    resetForm: false,
  });

  const initialRevokeKeyForm = untrack(() => submittedForm<RevokeAppKeyForm>(form, 'revokeKey') as RevokeAppKeySuperform | null ?? data.revokeKeyForm);
  const {
    form: revokeKeyForm,
    errors: revokeKeyErrors,
    message: revokeKeyMessage,
    submitting: revokeKeySubmitting,
    enhance: revokeKeyEnhance,
  } = superForm<RevokeAppKeyForm, App.Superforms.Message, RevokeAppKeyForm>(initialRevokeKeyForm, {
    validators: zod4Client(revokeAppKeySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialDeleteAppForm = untrack(() => submittedForm<DeleteAppForm>(form, 'deleteApp') as DeleteAppSuperform | null ?? data.deleteAppForm);
  const {
    errors: deleteAppErrors,
    message: deleteAppMessage,
    submitting: deleteAppSubmitting,
    enhance: deleteAppEnhance,
  } = superForm<DeleteAppForm, App.Superforms.Message, DeleteAppForm>(initialDeleteAppForm, {
    validators: zod4Client(deleteAppSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // ── Casting (#974) ───────────────────────────────────────────────────
  const initialCastWorkerForm = untrack(() => submittedForm<CastWorkerForm>(form, 'castWorker') as CastWorkerSuperform | null ?? data.castWorkerForm);
  const {
    form: castWorkerForm,
    errors: castWorkerErrors,
    message: castWorkerMessage,
    submitting: castWorkerSubmitting,
    enhance: castWorkerEnhance,
  } = superForm<CastWorkerForm, App.Superforms.Message, CastWorkerForm>(initialCastWorkerForm, {
    validators: zod4Client(castWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form: f }) => {
      // Clear the composer only on a clean cast, so a WORKER_NAME_TAKEN
      // refusal leaves the rejected name in the box to edit.
      if (f.valid && f.message?.type === 'success') {
        castWorkerForm.update(
          (current) => ({ ...current, agentId: '', name: '', role: '', promptOverride: '' }),
          { taint: false },
        );
        castOpen = false;
      }
    },
  });

  const initialRetireWorkerForm = untrack(() => submittedForm<RetireWorkerForm>(form, 'retireWorker') as RetireWorkerSuperform | null ?? data.retireWorkerForm);
  const {
    form: retireWorkerForm,
    errors: retireWorkerErrors,
    message: retireWorkerMessage,
    submitting: retireWorkerSubmitting,
    enhance: retireWorkerEnhance,
  } = superForm<RetireWorkerForm, App.Superforms.Message, RetireWorkerForm>(initialRetireWorkerForm, {
    validators: zod4Client(retireWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const settingsNameError = $derived($appSettingsErrors.name?.[0] ?? null);
  const settingsUrnError = $derived($appSettingsErrors.urn?.[0] ?? null);
  const settingsSessionTimeoutError = $derived($appSettingsErrors.sessionTimeoutSeconds?.[0] ?? null);
  const settingsAnonymousTtlError = $derived($appSettingsErrors.anonymousTtlDays?.[0] ?? null);
  const settingsActionError = $derived($appSettingsMessage?.type === 'error' ? $appSettingsMessage.text : null);
  const settingsActionSuccess = $derived($appSettingsMessage?.type === 'success' ? $appSettingsMessage.text : null);
  const addAgentError = $derived($addAgentErrors.agentId?.[0] ?? null);
  const addAgentActionError = $derived($addAgentMessage?.type === 'error' ? $addAgentMessage.text : null);
  const addAgentActionSuccess = $derived($addAgentMessage?.type === 'success' ? $addAgentMessage.text : null);
  const createKeyActionError = $derived($createKeyMessage?.type === 'error' ? $createKeyMessage.text : null);
  const removeAgentActionError = $derived(
    $removeAgentMessage?.type === 'error'
      ? $removeAgentMessage.text
      : $removeAgentErrors.agentId?.[0] ?? $removeAgentErrors._kind?.[0] ?? null,
  );
  const removeAgentActionSuccess = $derived($removeAgentMessage?.type === 'success' ? $removeAgentMessage.text : null);
  const updateAgentToolsActionError = $derived(
    $updateAgentToolsMessage?.type === 'error'
      ? $updateAgentToolsMessage.text
      : $updateAgentToolsErrors._kind?.[0] ?? $updateAgentToolsErrors.agentTools?.[0] ?? null,
  );
  const updateAgentToolsActionSuccess = $derived($updateAgentToolsMessage?.type === 'success' ? $updateAgentToolsMessage.text : null);
  const revokeKeyActionError = $derived(
    $revokeKeyMessage?.type === 'error'
      ? $revokeKeyMessage.text
      : $revokeKeyErrors.keyId?.[0] ?? $revokeKeyErrors._kind?.[0] ?? null,
  );
  const revokeKeyActionSuccess = $derived($revokeKeyMessage?.type === 'success' ? $revokeKeyMessage.text : null);
  const deleteAppActionError = $derived($deleteAppMessage?.type === 'error' ? $deleteAppMessage.text : $deleteAppErrors._kind?.[0] ?? null);
  const castWorkerAgentError = $derived($castWorkerErrors.agentId?.[0] ?? null);
  const castWorkerActionError = $derived(
    $castWorkerMessage?.type === 'error'
      ? $castWorkerMessage.text
      : $castWorkerErrors._kind?.[0] ?? null,
  );
  const castWorkerActionSuccess = $derived($castWorkerMessage?.type === 'success' ? $castWorkerMessage.text : null);
  const retireWorkerActionError = $derived(
    $retireWorkerMessage?.type === 'error'
      ? $retireWorkerMessage.text
      : $retireWorkerErrors.workerId?.[0] ?? $retireWorkerErrors._kind?.[0] ?? null,
  );
  const retireWorkerActionSuccess = $derived($retireWorkerMessage?.type === 'success' ? $retireWorkerMessage.text : null);

  // Retire is confirmed because it is one-way in the sense that matters: the
  // casting ends and the NAME stays reserved forever, so it can never be
  // re-cast under the same name. Say that in the prompt rather than asking a
  // bare "are you sure?".
  let retireForm = $state<HTMLFormElement>();
  async function retireWorkerNamed(workerId: string, workerName: string) {
    if ($retireWorkerSubmitting) return;
    const prompt = t(
      'app.staff.retire.confirm',
      'Retire this worker? Its work history stays, and its name stays reserved in this App permanently:',
    );
    if (!confirm(`${prompt} ${workerName}`)) return;
    retireWorkerForm.update((current) => ({ ...current, workerId }), { taint: false });
    await tick();
    retireForm?.requestSubmit();
  }

  $effect(() => {
    const submitted = submittedForm<AppSettingsForm>(form, 'updateApp') as AppSettingsSuperform | null;
    if (submitted && (!submitted.valid || submitted.message?.type === 'error')) {
      activeTab = 'settings';
      editMode = true;
    }
  });
  $effect(() => {
    if (
      submittedForm<AddAgentForm>(form, 'addAgent') ||
      submittedForm<RemoveAppAgentForm>(form, 'removeAgent') ||
      submittedForm<RevokeAppKeyForm>(form, 'revokeKey') ||
      submittedForm<DeleteAppForm>(form, 'deleteApp')
    ) {
      activeTab = 'settings';
    }
  });
  $effect(() => {
    if (submittedForm<UpdateAppAgentToolsForm>(form, 'updateAgentTools')) {
      activeTab = 'client';
    }
  });
  // Land back on Staff after a cast/retire so the outcome banner is visible
  // next to the list it changed.
  $effect(() => {
    if (
      submittedForm<CastWorkerForm>(form, 'castWorker') ||
      submittedForm<RetireWorkerForm>(form, 'retireWorker')
    ) {
      activeTab = 'staff';
    }
  });

  // Re-seed the Superform store from the current `app` every time the form
  // opens (and on cancel) so Edit reflects live data after enhanced saves.
  function syncEditFields() {
    appSettingsForm.update(
      (current) => ({
        ...current,
        name: app.name,
        urn: slugOfUrn(app.urn),
        appType: app.appType,
        role: app.role,
        description: app.description ?? '',
        systemPrompt: app.systemPrompt ?? '',
        createUserPermission: app.createUserPermission,
        identifyUserMethod: app.identifyUserMethod,
        sessionTimeoutSeconds: String(app.sessionTimeoutSeconds),
        anonymousTtlDays: String(app.anonymousTtlDays),
      }),
      { taint: false },
    );
  }

  // 008-agent-installation: an App has at most one Agent (App.agent_id, a
  // direct FK; the AppAgent join was dropped). The "subscribable agents"
  // list is now "agents not yet linked" — empty when an Agent is already set.
  const subscribableAgents = $derived(
    app.agent ? [] : availableAgents,
  );

  interface EffectiveMemory { id: string; urn: string; name: string; access: 'read' | 'read-write'; agentName: string }
  const effectiveMemories = $derived.by(() => {
    const map = new Map<string, EffectiveMemory>();
    if (app.agent) {
      for (const item of app.agent.memoryItems ?? []) {
        const effective = item.role === 'read-write' ? 'read-write' as const : 'read' as const;
        map.set(item.memory.id, {
          id: item.memory.id, urn: item.memory.urn, name: item.memory.name,
          access: effective, agentName: app.agent.name,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const SYSTEM_MEMORY_URNS = ['hadronmemory.com:core'];
  const userMemories = $derived(effectiveMemories.filter((m) => !SYSTEM_MEMORY_URNS.includes(m.urn)));
  const hasWritableMemory = $derived(effectiveMemories.some((m) => m.access === 'read-write'));
  const writableMemoryIds = $derived(effectiveMemories.filter((m) => m.access === 'read-write').map((m) => m.id));

  const newRawKey = $derived(form && 'rawKey' in form ? form.rawKey : undefined);

  function formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    return new Date(s).toLocaleString();
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CHATBOT: '💬', CLOUD: '☁️', IOT: '📡', AGENT: '🤖', AUTOMATION: '⚙️' };

  // ── Client tab state ────────────────────────────────────────────────
  const AGENT_TOOL_OPTIONS = [
    { value: 'CLAUDE_CODE', label: 'Claude Code', scope: 'project' },
    { value: 'COPILOT', label: 'GitHub Copilot', scope: 'project' },
    { value: 'CURSOR', label: 'Cursor', scope: 'project' },
    { value: 'WINDSURF', label: 'Windsurf', scope: 'global' },
    { value: 'ANTIGRAVITY', label: 'Antigravity', scope: 'global' },
    { value: 'CLAUDE_DESKTOP', label: 'Claude Desktop', scope: 'project' },
    { value: 'CODEX', label: 'Codex CLI', scope: 'project' },
    { value: 'CLINE', label: 'Cline', scope: 'project' },
  ];

  let downloading = $state(false);
  let agentToolsForm = $state<HTMLFormElement>();
  let selectedTools = $derived(new Set(app.agentTools ?? []));
  let withClientApp = $state(false);
  let newKeyLabel = $state('');
  let memoriesOpen = $state(false);

  const activeKeys = $derived((app.keys ?? []).filter((k) => !k.revokedAt));
  let newKeySectionOpen = $state(false);

  function sanitizeLabel(label: string): string {
    return (label || 'key').replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/-+/g, '-').toLowerCase();
  }

  function maskedKey(label: string | null, createdAt: string, keyPreview: string | null): string {
    const sanitized = sanitizeLabel(label ?? 'key');
    const dateStamp = new Date(createdAt).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const masked = keyPreview ? `${'••••••••'}${keyPreview}` : '••••••••••••';
    return `${sanitized}/${dateStamp}/${masked}`;
  }

  const trimmedLabel = $derived(newKeyLabel.trim());
  const sanitizedNewLabel = $derived(sanitizeLabel(trimmedLabel));
  const duplicateKeyName = $derived(
    trimmedLabel.length > 0 && activeKeys.some((k) => sanitizeLabel(k.label ?? 'key') === sanitizedNewLabel)
  );
  const canDownload = $derived(trimmedLabel.length > 0 && !duplicateKeyName && selectedTools.size > 0);
  const keyPreviewText = $derived(
    trimmedLabel.length > 0 ? `${sanitizedNewLabel}/${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}/••••••••••••` : ''
  );

  function toggleTool(value: string) {
    if (selectedTools.has(value)) { selectedTools.delete(value); } else { selectedTools.add(value); }
    selectedTools = new Set(selectedTools);
    updateAgentToolsForm.update((current) => ({ ...current, agentTools: [...selectedTools] }), { taint: false });
    setTimeout(() => agentToolsForm?.requestSubmit(), 0);
  }

  function setRemoveAgent(agentId: string) {
    removeAgentForm.update((current) => ({ ...current, agentId }), { taint: false });
  }

  function setRevokeKey(keyId: string) {
    revokeKeyForm.update((current) => ({ ...current, keyId }), { taint: false });
  }

  // ── Per-tool MCP config generators ────────────────────────────────────
  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
  const clientAppUrl = 'http://localhost:3200';
  const mcpBaseUrl = $derived(withClientApp ? clientAppUrl : serverUrl);
  const mcpUrl = $derived(mcpBaseUrl.includes('localhost') ? mcpBaseUrl + '/mcp' : mcpBaseUrl.replace(/\/$/, '') + '/mcp');

  function claudeCodeMcpConfig(url: string, apiKey: string, useClientApp: boolean) {
    if (useClientApp) {
      return { mcpServers: { hadron: { command: 'hadron-client', args: ['stdio'], env: { HADRON_CLIENT_KEY: apiKey } } } };
    }
    return { mcpServers: { hadron: { type: 'http', url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function copilotMcpConfig(url: string, apiKey: string) {
    return { servers: { hadron: { type: 'url', url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } }, inputs: [] };
  }
  function cursorMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function windsurfMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function antigravityMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function claudeCodeHooksConfig() {
    return { hooks: {
      SessionStart: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/session-start`, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/before-prompt`, timeout: 5 }] }],
      PostToolUse: [{ matcher: 'mcp__hadron', hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/after-tool`, timeout: 5 }] }],
      PostCompact: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/post-compact`, timeout: 5 }] }],
    }};
  }

  const INSTRUCTIONS_MD = hadronInstructions;

  async function generateAndDownloadZip(apiKey: string, keyLabel: string) {
    const zip = new JSZip();
    const tools = app.agentTools ?? [];
    const url = mcpUrl;

    if (tools.includes('CLAUDE_CODE')) {
      const pluginManifest: Record<string, unknown> = {
        name: 'hadron',
        version: '1.0.0',
        description: `Hadron knowledge memory for app "${app.name}"`,
        author: { name: 'Baragaun', url: 'https://hadronmemory.com' },
        homepage: 'https://hadronmemory.com',
        license: 'MIT',
        keywords: ['hadron', 'memory', 'knowledge-graph', 'mcp'],
      };
      if (withClientApp) {
        pluginManifest.hooks = claudeCodeHooksConfig().hooks;
      }
      const mcpConfig = claudeCodeMcpConfig(url, apiKey, withClientApp);
      const marketplaceManifest = {
        name: 'hadron',
        owner: { name: 'Baragaun', email: 'help@hadronmemory.com' },
        metadata: { description: 'Hadron knowledge memory plugins' },
        plugins: [{
          name: 'hadron',
          source: './plugins/hadron',
          description: `Hadron knowledge memory for app "${app.name}"`,
          version: '1.0.0',
          author: { name: 'Baragaun' },
        }],
      };
      zip.file('.hadron/plugin/.claude-plugin/marketplace.json', JSON.stringify(marketplaceManifest, null, 2));
      zip.file('.hadron/plugin/plugins/hadron/.claude-plugin/plugin.json', JSON.stringify(pluginManifest, null, 2));
      zip.file('.mcp.json', JSON.stringify(mcpConfig, null, 2));
      zip.file('.hadron/plugin/plugins/hadron/skills/get-started/SKILL.md',
`---
name: get-started
description: Learn how to use Hadron knowledge memory in this project
---

You are helping the user get started with Hadron, a knowledge memory platform for AI agents.

This project is connected to Hadron app "${app.name}".

Available MCP tools:
- **hadron_start_session** / **hadron_end_session** — Track work sessions
- **hadron_find_nodes** — Search nodes by name, tags, or description
- **hadron_get_node** — Read a node's full content and edges
- **hadron_get_next_node** — Navigate to the next sibling node
- **hadron_create_node** — Create a new node
- **hadron_update_node** — Partially update a node
- **hadron_move_node** — Rename or move a node
- **hadron_validate** — Validate graph structure
- **hadron_sync_graph** — Trigger a sync from the git source

Start by calling hadron_start_session, then use hadron_find_nodes to explore what knowledge is available.
When you learn something new, save it with hadron_create_node or hadron_update_node.
`);
      zip.file('.hadron/plugin/plugins/hadron/skills/search/SKILL.md',
`---
name: search
description: Search the Hadron knowledge graph
---

Search the Hadron knowledge graph for relevant information.
Use hadron_find_nodes with the user's query to find matching nodes, then read the most relevant ones with hadron_get_node.
Present the results concisely.
`);
    }

    if (tools.includes('CLAUDE_CODE'))
      zip.file('.mcp.json', JSON.stringify(claudeCodeMcpConfig(url, apiKey, withClientApp), null, 2));
    if (tools.includes('COPILOT'))
      zip.file('.vscode/mcp.json', JSON.stringify(copilotMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CURSOR'))
      zip.file('.cursor/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CLAUDE_DESKTOP'))
      zip.file('claude_desktop_config.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CODEX'))
      zip.file('.codex/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CLINE'))
      zip.file('.cline/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('WINDSURF'))
      zip.file('global-configs/windsurf-mcp_config.json', JSON.stringify(windsurfMcpConfig(url, apiKey), null, 2));
    if (tools.includes('ANTIGRAVITY'))
      zip.file('global-configs/antigravity-mcp_config.json', JSON.stringify(antigravityMcpConfig(url, apiKey), null, 2));

    if (withClientApp) {
      if (tools.includes('CLAUDE_CODE'))
        zip.file('.claude/settings.json', JSON.stringify(claudeCodeHooksConfig(), null, 2));
      zip.file('.hadron/config.json', JSON.stringify({ appKey: apiKey, defaultLevel: 'guided' }, null, 2));
    }

    zip.file('.hadron/INSTRUCTIONS.md', INSTRUCTIONS_MD);

    const user = data.user;
    const configYml = [
      '# .hadron/config.yml',
      '#',
      '# Project-level configuration for Hadron. This file lives in the .hadron/',
      '# directory at the project root and persists across sessions.',
      '',
      '# The default Hadron memory URN for this project.',
      '# Set as the active memory at session start via hadron_set_active_memory.',
      'default_memory:',
      '',
      '# Engineer identity. Used for attribution, script selection, and lookups.',
      'user:',
      `  user_id: ${user?.id ?? ''}`,
      `  username: ${user?.name ?? ''}`,
      `  email: "${user?.email ?? ''}"`,
      `  github_username: "${user?.githubUsername ?? ''}"`,
    ].join('\n');
    zip.file('.hadron/config.yml', configYml);

    zip.file('bin/hadron-client',
`#!/usr/bin/env bash
# Hadron Client launcher — place this on your PATH (e.g. ~/bin or /usr/local/bin)
# Requires: Node.js >= 20, hadron-client repo cloned and built

HADRON_CLIENT_DIR="\${HADRON_CLIENT_DIR:-\$HOME/src/hadron-memory/hadron-client}"
node "\$HADRON_CLIENT_DIR/dist/cli.js" "$@"
`);

    const hasGlobalTools = tools.includes('WINDSURF') || tools.includes('ANTIGRAVITY');
    const readmeLines = [
      '# Hadron Client Setup',
      '',
      '## Client Key',
      '',
      '```',
      apiKey,
      '```',
      '',
      '> **Keep your client key safe and do not share it with others!**',
      '',
      '## Prerequisites',
      '',
      '1. **Node.js >= 20** installed',
      '2. **Clone and build hadron-client:**',
      '   ```bash',
      '   git clone https://github.com/hadron-memory/hadron-client.git ~/src/hadron-memory/hadron-client',
      '   cd ~/src/hadron-memory/hadron-client',
      '   npm install && npm run build',
      '   ```',
      '3. **Install the `hadron-client` command** — copy the wrapper script to a directory on your PATH:',
      '   ```bash',
      '   cp bin/hadron-client ~/bin/hadron-client   # or /usr/local/bin/',
      '   chmod +x ~/bin/hadron-client',
      '   ```',
      '   If your hadron-client repo is not at `~/src/hadron-memory/hadron-client`,',
      '   set `HADRON_CLIENT_DIR` in the script or your shell profile.',
      '',
      '## To upgrade',
      '',
      '```bash',
      '~/src/hadron-memory/hadron-client/bin/upgrade.sh',
      '```',
      '',
      'Then restart your AI coding tool (or reconnect MCP) to pick up changes.',
      '',
      '## Project Setup',
      '',
      '### Hadron config',
      '',
      '1. Copy `.hadron/` into your project root',
      '2. Edit `.hadron/config.yml` — fill in your `default_memory`, user details, etc.',
      '3. `.hadron/INSTRUCTIONS.md` is read by AI agents — no edits needed',
      '',
      '### AI tool configs',
      '',
      'Copy the relevant config files into your project root:',
    ];
    if (tools.includes('CLAUDE_CODE'))
      readmeLines.push('', '### Claude Code', '', '- Copy `.mcp.json` to your project root');
    if (tools.includes('COPILOT'))
      readmeLines.push('', '### GitHub Copilot', '', '- Copy `.vscode/mcp.json` to your project', '- Docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers');
    if (tools.includes('CURSOR'))
      readmeLines.push('', '### Cursor', '', '- Copy `.cursor/mcp.json` to your project', '- Docs: https://cursor.com/docs/mcp');
    if (tools.includes('CLAUDE_DESKTOP'))
      readmeLines.push('', '### Claude Desktop', '', '- Merge `claude_desktop_config.json` into your Claude Desktop config');
    if (tools.includes('CODEX'))
      readmeLines.push('', '### Codex CLI', '', '- Copy `.codex/mcp.json` to your project');
    if (tools.includes('CLINE'))
      readmeLines.push('', '### Cline', '', '- Copy `.cline/mcp.json` to your project');
    if (hasGlobalTools) {
      readmeLines.push('', '### Global-only configs', '', 'These tools only support global MCP configuration.', 'Merge the hadron entry from the `global-configs/` folder into your existing config file.');
      if (tools.includes('WINDSURF'))
        readmeLines.push('', '**Windsurf:** Merge into `~/.codeium/windsurf/mcp_config.json`');
      if (tools.includes('ANTIGRAVITY'))
        readmeLines.push('', '**Antigravity:** Merge into `~/.antigravity/mcp_config.json`');
    }
    if (withClientApp) readmeLines.push(
      '', '### Hadron Client App', '',
      'The client app provides hooks for session tracking and context recovery.',
      '1. Copy `.hadron/config.json` to your project',
      '2. Start the client app: `hadron-client start`',
      '3. Copy `.claude/settings.json` to your project (hooks config)',
    );
    zip.file('README.md', readmeLines.join('\n'));

    const blob = await zip.generateAsync({ type: 'blob' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = sanitizeLabel(keyLabel);
    a.href = dlUrl; a.download = `hadron-client-config-${safeName}.zip`; a.click();
    URL.revokeObjectURL(dlUrl);
  }

  async function downloadSetupZip() {
    if (!canDownload) return;
    const label = trimmedLabel;
    downloading = true;
    try {
      const res = await fetch('/api/create-app-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: app.id, label }),
      });
      if (!res.ok) { alert('Failed to create client key.'); return; }
      const { rawKey } = await res.json();
      if (!rawKey) { alert('Failed to create client key.'); return; }
      newKeyLabel = '';
      await generateAndDownloadZip(rawKey, label);
    } finally { downloading = false; }
  }
</script>

<svelte:head><title>{app.name} · Apps · {org ? `${org.name} · ` : ''}Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Apps', href: appsHref },
      { label: app.name },
    ]} />
    <div class="mt-2 flex items-start justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
          <span>{typeIcon[app.appType] ?? '🔑'}</span>
          <span><span class="text-zinc-400 font-normal">App:</span> {app.name}</span>
          {#if !hasWritableMemory && app.agent}
            <span class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">read-only</span>
          {/if}
        </h1>
        <div class="mt-1"><Urn value={app.urn} type="app" /></div>
      </div>
    </div>
  </div>

  {#if removeAgentActionError || updateAgentToolsActionError || revokeKeyActionError || deleteAppActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      {removeAgentActionError ?? updateAgentToolsActionError ?? revokeKeyActionError ?? deleteAppActionError}
    </div>
  {/if}
  {#if settingsActionSuccess || addAgentActionSuccess || removeAgentActionSuccess || updateAgentToolsActionSuccess || revokeKeyActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {settingsActionSuccess ?? addAgentActionSuccess ?? removeAgentActionSuccess ?? updateAgentToolsActionSuccess ?? revokeKeyActionSuccess}
    </div>
  {/if}

  {#if newRawKey}
    <div class="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-950/30">
      <h3 class="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">Save this key — it will not be shown again</h3>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">{newRawKey}</code>
        <button type="button"
          onclick={() => { navigator.clipboard.writeText(newRawKey); }}
          class="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600">
          Copy
        </button>
      </div>
      <p class="mt-2 text-xs text-amber-800 dark:text-amber-300">
        This is an App Key. It lives in your backend server as an environment variable.
        Never embed it in a browser, mobile app, or client-side code. Anyone with this key
        can impersonate any user of this app.
      </p>
    </div>
  {/if}

  <!-- Tabs -->
  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab}
      <button
        onclick={() => activeTab = tab.id}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >
        {tab.label}
      </button>
    {/each}
    <!-- Runs is a real subroute (deep-linkable from "Test flow" and run
         records), so it's a link styled as a tab, not an activeTab state. -->
    <a
      href="/app/apps/{app.id}/runs"
      class="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {t('app.tabs.runs', 'Runs')}
    </a>
  </div>

  <!-- ───────────── CHAT TAB (CHATBOT only) ───────────── -->
  {#if activeTab === 'chat'}
    <div class="flex flex-col" style="height: calc(100vh - 280px);">
      {#if appChatRender === 'agent-chat' && app.agentId}
        <div class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <AgentChat
            agentId={app.agentId}
            appId={app.id}
            configName={effectiveConfigName ?? undefined}
            uploadMemoryId={writableMemoryIds[0]}
          />
        </div>
        {#if usableChatConfigs.length > 0}
          <!-- Config picker sits below the chat, next to where the composer
               lives — matching where model pickers appear in most chat apps. -->
          <div class="mt-2 flex items-center gap-2 text-sm">
            <label for="chat-config" class="text-zinc-500">{t('app-chat.config.label', 'AI config')}</label>
            <select
              id="chat-config"
              value={effectiveConfigName ?? ''}
              onchange={(e) => (selectedConfigName = e.currentTarget.value)}
              class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {#each usableChatConfigs as c (c.id)}
                <option value={c.name}>{c.name} ({c.provider} · {c.model})</option>
              {/each}
            </select>
          </div>
        {/if}
      {:else if appChatRender === 'no-llm-config'}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <div class="max-w-md text-center">
            <p class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app-chat.no-llm.title', 'Connect an LLM provider to enable chat')}
            </p>
            <p class="mb-4 text-sm text-zinc-500">
              {t(
                'app-chat.no-llm.description',
                'This App has a chatbot agent linked, but no AI service configuration with a key resolves for it yet. Add one for this App, its agent, or the organization.',
              )}
            </p>
            <button
              onclick={() => activeTab = 'settings'}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              {t('app-chat.no-llm.cta', 'Configure AI providers in Settings')}
            </button>
          </div>
        </div>
      {:else if appChatRender === 'empty-no-agent'}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <div class="max-w-md text-center">
            <p class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app-chat.empty.title', 'Link a chatbot agent to enable chat')}
            </p>
            <p class="mb-4 text-sm text-zinc-500">
              {t(
                'app-chat.empty.description',
                "This App has the chat surface enabled but no agent is linked yet. The chatbot's conversations, stages, and prompts come from a linked Agent.",
              )}
            </p>
            <button
              onclick={() => activeTab = 'settings'}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              {t('app-chat.empty.link-agent-cta', 'Link an agent in Settings')}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ───────────── TEAM CHAT TAB (#732) ─────────────
       The App's team chat: the shared thread its workers and members post to.
       NOT the Chat tab above — that is an agent chat session, a different
       surface backed by a different operation. Read through the canonical
       `teamChatMessages` operation, never by walking appNodes, which cannot
       reach the App's shared memory at all (hadron-server#1031).

       No LLM composer, no delete, no rename — see #732 and the component. -->
  {#if activeTab === 'team-chat'}
    <div class="flex flex-col" style="height: calc(100vh - 280px);">
      <div class="mb-3">
        <h2 class="font-semibold text-zinc-900 dark:text-white">
          {t('app.team-chat.title', 'Team chat')}
        </h2>
        <p class="mt-1 max-w-2xl text-sm text-zinc-500">
          {t(
            'app.team-chat.description',
            'The shared thread for this App’s team. Workers post here from their worker sessions; you post as yourself.',
          )}
        </p>
      </div>
      <!-- flex flex-col is load-bearing, not decoration: the thread's root sizes
           itself with `flex-1 min-h-0`, which is inert unless its PARENT is a
           flex container. Without it the thread grows to its content height and
           `overflow-hidden` clips the composer out of the page entirely — the
           transcript reads fine and the reply box is simply gone. -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <TeamChatThread
          messages={data.teamChatMessages ?? []}
          total={data.teamChatTotal ?? 0}
          loadError={data.teamChatError ?? false}
          postForm={data.postTeamChatMessageForm}
          {form}
        />
      </div>
    </div>
  {/if}

  <!-- ───────────── STAFF TAB (#974) ─────────────
       The App's Workers: the named castings of its installed agents. This IS
       App context, so names render BARE (`cor:agt:020:02` — per-App uniqueness
       makes them unambiguous here). The app-qualified compound belongs on
       org-wide surfaces, never here. -->
  {#if activeTab === 'staff'}
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-zinc-900 dark:text-white">{t('app.staff.title', 'Staff')}</h2>
          <p class="mt-1 max-w-2xl text-sm text-zinc-500">
            {t(
              'app.staff.description',
              'The workers cast into this App — a named identity doing attributable work, backed by one of the installed agents. Human members are managed separately.',
            )}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <a
            href="/app/apps/{app.id}/members"
            class="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('app.staff.members-link', 'People')}
          </a>
          <button
            type="button"
            onclick={() => (castOpen = !castOpen)}
            aria-expanded={castOpen}
            class="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style="background: #fb8500;"
            disabled={castableAgents.length === 0}
          >
            {t('app.staff.cast', 'Cast a worker')}
          </button>
        </div>
      </div>

      {#if castWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {castWorkerActionError}
        </div>
      {/if}
      {#if castWorkerActionSuccess}
        <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {castWorkerActionSuccess}
        </div>
      {/if}
      {#if retireWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {retireWorkerActionError}
        </div>
      {/if}
      {#if retireWorkerActionSuccess}
        <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {retireWorkerActionSuccess}
        </div>
      {/if}

      {#if castableAgents.length === 0}
        <p class="text-sm text-zinc-500">
          {t(
            'app.staff.no-roster',
            'No agents are installed in this App yet, so there is nothing to cast. Install one from Settings first.',
          )}
        </p>
      {/if}

      <!-- Cast composer. Name and role are OPTIONAL: leaving the name blank
           draws the next free name from the Team Agent's cast-list register,
           and leaving the role blank inherits the agent's persona role. -->
      {#if castOpen && castableAgents.length > 0}
        <form
          method="POST"
          action="?/castWorker"
          use:castWorkerEnhance
          novalidate
          class="max-w-lg space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <input type="hidden" name="_kind" value={$castWorkerForm._kind} />
          <div>
            <label for="castAgentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.agent', 'Agent')}
            </label>
            <select
              id="castAgentId"
              name="agentId"
              bind:value={$castWorkerForm.agentId}
              aria-invalid={!!castWorkerAgentError}
              aria-describedby={castWorkerAgentError ? 'castAgentIdError' : 'castAgentIdHelp'}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">{t('app.staff.field.agent.placeholder', '— Select an installed agent —')}</option>
              {#each castableAgents as candidate (candidate.id)}
                <option value={candidate.id}>
                  {candidate.name}{candidate.personaRole ? ` (${candidate.personaRole})` : ''}
                </option>
              {/each}
            </select>
            {#if castWorkerAgentError}
              <p id="castAgentIdError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{castWorkerAgentError}</p>
            {:else}
              <p id="castAgentIdHelp" class="mt-1 text-xs text-zinc-400">
                {t('app.staff.field.agent.help', 'One of this App’s installed agents. The same agent can be cast more than once, under different names.')}
              </p>
            {/if}
          </div>
          <div>
            <label for="castName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.name', 'Name')}
            </label>
            <input
              id="castName"
              name="name"
              type="text"
              placeholder="Iris"
              bind:value={$castWorkerForm.name}
              aria-describedby="castNameHelp"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <p id="castNameHelp" class="mt-1 text-xs text-zinc-400">
              {t('app.staff.field.name.help', 'Leave blank to draw the next free name from this role’s cast list. A name is reserved in this App permanently — retiring a worker never frees it.')}
            </p>
          </div>
          <div>
            <label for="castRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.role', 'Role')}
            </label>
            <input
              id="castRole"
              name="role"
              type="text"
              placeholder="backend-engineer"
              bind:value={$castWorkerForm.role}
              aria-describedby="castRoleHelp"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            <p id="castRoleHelp" class="mt-1 text-xs text-zinc-400">
              {t('app.staff.field.role.help', 'Leave blank to inherit the agent’s persona role.')}
            </p>
          </div>
          <div>
            <label for="castPromptOverride" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.prompt-override', 'Prompt override')}
            </label>
            <textarea
              id="castPromptOverride"
              name="promptOverride"
              rows="3"
              bind:value={$castWorkerForm.promptOverride}
              aria-describedby="castPromptOverrideHelp"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            ></textarea>
            <p id="castPromptOverrideHelp" class="mt-1 text-xs text-zinc-400">
              {t('app.staff.field.prompt-override.help', 'Optional. Appended to the agent’s prompt template as this worker’s own paragraph.')}
            </p>
          </div>
          <div class="flex gap-3">
            <button
              type="submit"
              disabled={$castWorkerSubmitting}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {$castWorkerSubmitting ? t('app.staff.casting', 'Casting…') : t('app.staff.cast.submit', 'Cast')}
            </button>
            <button
              type="button"
              onclick={() => (castOpen = false)}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {t('app.staff.cast.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      {/if}

      <form bind:this={retireForm} method="POST" action="?/retireWorker" class="hidden" use:retireWorkerEnhance novalidate>
        <input type="hidden" name="_kind" value={$retireWorkerForm._kind} />
        <input type="hidden" name="workerId" value={$retireWorkerForm.workerId} />
      </form>

      {#if staffError}
        <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {t('app.staff.unavailable', 'The staff list couldn’t be loaded — try again in a moment.')}
        </div>
      {:else if sortedStaff.length === 0}
        <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            {t('app.staff.empty.title', 'No workers cast into this App yet.')}
          </p>
          <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
            {t(
              'app.staff.empty.explainer',
              'Casting gives an installed agent a name in this App, so its work can be attributed to someone rather than to a role.',
            )}
          </p>
        </div>
      {:else}
        <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {#each sortedStaff as worker (worker.id)}
            <li class="flex items-start justify-between gap-4 px-5 py-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <!-- BARE name: this is App context. -->
                  <span class="text-sm font-medium text-zinc-900 dark:text-white {worker.retiredAt ? 'line-through opacity-60' : ''}">
                    {worker.name}
                  </span>
                  <WorkerBadge retired={!!worker.retiredAt} />
                </div>
                <p class="mt-1 truncate text-xs text-zinc-500">
                  {worker.role ?? t('app.staff.no-role', 'No role')}
                  {#if worker.agent}
                    · <a href="/app/agents/{worker.agent.id}" class="text-indigo-600 hover:underline dark:text-indigo-400">{worker.agent.name}</a>
                  {:else}
                    · <span class="italic">{t('app.staff.agent-unavailable', 'backing agent unavailable')}</span>
                  {/if}
                </p>
                {#if worker.memoryId}
                  <a href="/app/memories/{worker.memoryId}" class="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                    {t('app.staff.working-memory', 'Working memory →')}
                  </a>
                {/if}
              </div>
              {#if !worker.retiredAt}
                <button
                  type="button"
                  onclick={() => retireWorkerNamed(worker.id, worker.name)}
                  disabled={$retireWorkerSubmitting}
                  class="shrink-0 text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('app.staff.retire', 'Retire')}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <!-- ───────────── MEMORY TAB ───────────── -->
  {#if activeTab === 'memory'}
    <MemoryBrowser nodes={data.appNodes ?? []} multiMemory={true} {writableMemoryIds} scopeMemoryIds={effectiveMemories.map((m) => m.id)} />
  {/if}

  <!-- ───────────── SETTINGS TAB ───────────── -->
  {#if activeTab === 'settings'}
    <div class="space-y-8">
      <!-- App settings (form-driven; mirrors the legacy fields, including the org-original ones) -->
      <section class="max-w-lg">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">App</h2>
          {#if !editMode}
            <button type="button" onclick={() => { syncEditFields(); editMode = true; }}
              class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Edit
            </button>
          {/if}
        </div>

        {#if editMode}
          <form method="POST" action="?/update" use:appSettingsEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
            <input type="hidden" name="_kind" value={$appSettingsForm._kind} />
            {#if settingsActionError}
              <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{settingsActionError}</div>
            {/if}
            <div>
              <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input
                id="name"
                type="text"
                name="name"
                bind:value={$appSettingsForm.name}
                aria-invalid={!!settingsNameError}
                aria-describedby={settingsNameError ? 'nameError' : undefined}
                {...$appSettingsConstraints.name}
                class="{inputClass} {settingsNameError ? 'border-red-500 focus:border-red-500' : ''}"
              />
              {#if settingsNameError}
                <p id="nameError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsNameError}</p>
              {/if}
            </div>
            <div>
              <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <div class="flex items-stretch">
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{urnPrefix}:</span>
                <input
                  id="urn"
                  type="text"
                  name="urn"
                  bind:value={$appSettingsForm.urn}
                  aria-invalid={!!settingsUrnError}
                  aria-describedby={settingsUrnError ? 'urnError urnHint' : 'urnHint'}
                  {...$appSettingsConstraints.urn}
                  class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white {settingsUrnError ? 'border-red-500 focus:border-red-500' : ''}"
                />
              </div>
              <p id="urnHint" class="mt-1 text-xs text-zinc-400">The slug must be unique within the organization. Changing this rewrites the URN.</p>
              {#if settingsUrnError}
                <p id="urnError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsUrnError}</p>
              {/if}
            </div>
            <div>
              <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <input id="description" type="text" name="description" bind:value={$appSettingsForm.description} placeholder="What this app is for" class={inputClass} />
            </div>
            <div>
              <label for="systemPrompt" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
              <textarea id="systemPrompt" name="systemPrompt" rows="4" bind:value={$appSettingsForm.systemPrompt}
                placeholder="Instructions for the LLM when using this app"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"></textarea>
              <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each session.</p>
            </div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="appType" name="appType" bind:value={$appSettingsForm.appType}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="WORKSTATION">💻 Workstation</option>
                  <option value="CHATBOT">💬 Chatbot</option>
                  <option value="AGENT">🤖 Agent</option>
                  <option value="AUTOMATION">⚙️ Automation</option>
                  <option value="CLOUD">☁️ Cloud</option>
                  <option value="IOT">📡 IoT</option>
                </select>
              </div>
              <div>
                <label for="editRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
                <select id="editRole" name="role" bind:value={$appSettingsForm.role}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  {#if $appSettingsForm.role === 'OWNER'}
                    <option value="OWNER">Owner</option>
                  {/if}
                  <option value="READER">Reader</option>
                  <option value="CONTRIBUTOR">Contributor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div>
                <label for="cup" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">User creation</label>
                <select id="cup" name="createUserPermission" bind:value={$appSettingsForm.createUserPermission}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="DENY">DENY</option>
                  <option value="EXPLICIT">EXPLICIT</option>
                  <option value="IMPLICIT">IMPLICIT</option>
                </select>
              </div>
              <div>
                <label for="ium" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Identify user by</label>
                <select id="ium" name="identifyUserMethod" bind:value={$appSettingsForm.identifyUserMethod}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="USER_ID">USER_ID</option>
                  <option value="SECRET">SECRET</option>
                </select>
              </div>
              <div>
                <label for="timeout" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Session timeout (seconds)</label>
                <input
                  id="timeout"
                  type="text"
                  inputmode="numeric"
                  name="sessionTimeoutSeconds"
                  bind:value={$appSettingsForm.sessionTimeoutSeconds}
                  aria-invalid={!!settingsSessionTimeoutError}
                  aria-describedby={settingsSessionTimeoutError ? 'timeoutError' : undefined}
                  {...$appSettingsConstraints.sessionTimeoutSeconds}
                  class="{inputClass} {settingsSessionTimeoutError ? 'border-red-500 focus:border-red-500' : ''}"
                />
                {#if settingsSessionTimeoutError}
                  <p id="timeoutError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsSessionTimeoutError}</p>
                {/if}
              </div>
              <div>
                <label for="anonttl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Anonymous TTL (days)</label>
                <input
                  id="anonttl"
                  type="text"
                  inputmode="numeric"
                  name="anonymousTtlDays"
                  bind:value={$appSettingsForm.anonymousTtlDays}
                  aria-invalid={!!settingsAnonymousTtlError}
                  aria-describedby={settingsAnonymousTtlError ? 'anonymousTtlError' : undefined}
                  {...$appSettingsConstraints.anonymousTtlDays}
                  class="{inputClass} {settingsAnonymousTtlError ? 'border-red-500 focus:border-red-500' : ''}"
                />
                {#if settingsAnonymousTtlError}
                  <p id="anonymousTtlError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsAnonymousTtlError}</p>
                {/if}
              </div>
            </div>
            <div class="flex gap-2">
              <button type="submit" disabled={$appSettingsSubmitting} class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
                {$appSettingsSubmitting ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onclick={() => { editMode = false; syncEditFields(); }}
                class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">
                Cancel
              </button>
            </div>
          </form>
        {:else}
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Type</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.appType}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Role</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.role}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">URN</span>
              <span class="text-sm font-mono text-zinc-900 dark:text-white">{app.urn}</span>
            </div>
            {#if app.description}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Description</span>
                <span class="text-sm text-zinc-900 dark:text-white">{app.description}</span>
              </div>
            {/if}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">User creation</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.createUserPermission}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Identify user by</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.identifyUserMethod}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Session timeout</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.sessionTimeoutSeconds} seconds</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Anonymous TTL</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.anonymousTtlDays} days</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Created</span>
              <span class="text-sm text-zinc-900 dark:text-white">{new Date(app.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        {/if}
      </section>

      <!-- Agent (008: at most one per App, via the direct App.agent_id FK) -->
      <section class="max-w-2xl">
        <h2 class="mb-3 flex items-baseline gap-3 text-lg font-semibold text-zinc-900 dark:text-white">
          <span>Agent</span>
          {#if app.agent}
            <a href="/app/apps/{app.id}/members"
              class="text-sm font-normal text-indigo-500 hover:underline dark:text-indigo-400">
              {app.memberCount} {app.memberCount === 1 ? 'member' : 'members'} →
            </a>
          {/if}
        </h2>
        <p class="mb-3 text-sm text-zinc-500">The Agent this App deploys. App Key holders can only call into this Agent.</p>

        {#if app.agent}
          <div class="mb-4 rounded-xl border border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div class="flex items-center gap-4">
              <span class="text-base">🤖</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{app.agent.name}</p>
                <Urn value={app.agent.urn} type="agent" size={10} />
                {#if app.installedAgentUrn}
                  <!-- Spec 021 US1: R2 canonical install URN. Surfaces the
                       canonical form that audit logs reference, so the
                       user can copy/paste the install URN without
                       composing it manually. -->
                  <div class="mt-1">
                    <span class="mr-1 text-xs text-zinc-500">Install URN:</span>
                    <Urn value={app.installedAgentUrn} type="agent" size={10} />
                  </div>
                {/if}
                {#if app.agent.description}
                  <p class="mt-1 text-xs text-zinc-500">{app.agent.description}</p>
                {/if}
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1 text-xs text-zinc-500">
                <span>{app.trainingMode ? 'Training mode' : 'Production'}</span>
                {#if (app.surfaces ?? []).length > 0}
                  <span>Surfaces: {(app.surfaces ?? []).join(', ')}</span>
                {/if}
              </div>
              <!-- Keep both handlers: onclick updates before client validation for button activation;
                   onsubmit covers keyboard/requestSubmit paths. -->
              <form method="POST" action="?/removeAgent" use:removeAgentEnhance onsubmit={() => setRemoveAgent(app.agent?.id ?? '')} class="shrink-0" novalidate>
                <input type="hidden" name="_kind" value="removeAgent" />
                <input type="hidden" name="agentId" value={app.agent.id} />
                <button type="submit" disabled={$removeAgentSubmitting} onclick={() => setRemoveAgent(app.agent?.id ?? '')} class="text-xs text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50">Unlink</button>
              </form>
            </div>
          </div>
        {:else}
          <p class="mb-4 text-sm text-zinc-500">No agent linked yet.</p>
          {#if subscribableAgents.length > 0 || availableAgents.length > 0}
            <form method="POST" action="?/addAgent" use:addAgentEnhance class="flex flex-wrap items-start gap-3" novalidate>
              <input type="hidden" name="_kind" value={$addAgentForm._kind} />
              <div class="flex-1 min-w-[200px]">
                <label for="agentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Link an agent</label>
                <select
                  id="agentId"
                  name="agentId"
                  bind:value={$addAgentForm.agentId}
                  aria-invalid={!!addAgentError}
                  aria-describedby={addAgentError ? 'addAgentError' : undefined}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white {addAgentError ? 'border-red-500 focus:border-red-500' : ''}"
                >
                  <option value="">Select…</option>
                  {#each (subscribableAgents.length > 0 ? subscribableAgents : availableAgents) as a (a.id)}
                    <option value={a.id}>{a.name} ({a.urn})</option>
                  {/each}
                </select>
                {#if addAgentError}
                  <p id="addAgentError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{addAgentError}</p>
                {/if}
                {#if addAgentActionError}
                  <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{addAgentActionError}</p>
                {/if}
              </div>
              <button type="submit" disabled={!$addAgentForm.agentId || $addAgentSubmitting}
                class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                style="background: #219ebc;">
                {$addAgentSubmitting ? 'Linking...' : 'Link'}
              </button>
            </form>
          {/if}
        {/if}
      </section>

      <!-- Accessible Memories (collapsed) -->
      {#if userMemories.length > 0}
        <section class="max-w-2xl">
          <button onclick={() => memoriesOpen = !memoriesOpen} class="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {memoriesOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
            Accessible Memories
            <span class="text-sm font-normal text-zinc-500">({userMemories.length})</span>
          </button>
          {#if memoriesOpen}
          <div class="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each userMemories as mem (mem.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="text-base">🧠</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{mem.name}</p>
                  <Urn value={mem.urn} type="memory" size={10} />
                </div>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {mem.access === 'read-write' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">{mem.access}</span>
                <span class="text-xs text-zinc-400">via {mem.agentName}</span>
              </div>
            {/each}
          </div>
          {/if}
        </section>
      {/if}

      <!-- AI providers (registry; consumers resolve a config by name) -->
      <section class="max-w-2xl">
        <AiServiceConfigSection
          ownerType="APP"
          ownerId={app.id}
          configs={data.appConfigs ?? []}
          members={org?.members ?? []}
          currentUserId={data.currentUserId}
          configsError={data.configsError}
        />
      </section>

      <!-- App Keys (always visible in Settings; richer download flow lives on Client tab for non-CHATBOT apps) -->
      <section class="max-w-2xl">
        <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">App Keys</h2>
        <p class="mb-4 text-sm text-zinc-500">
          App Keys are long-lived server secrets. Store them in your backend environment —
          never in client-side code.
        </p>

        <form method="POST" action="?/createKey" use:createKeyEnhance class="mb-5 flex items-start gap-2" novalidate>
          <input type="hidden" name="_kind" value={$createKeyForm._kind} />
          <div class="flex-1">
            <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Label (optional)</label>
            <input id="label" type="text" name="label" placeholder="e.g. production-backend"
              bind:value={$createKeyForm.label} class={inputClass} />
            {#if createKeyActionError}
              <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{createKeyActionError}</p>
            {/if}
          </div>
          <button type="submit" disabled={$createKeySubmitting}
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
            {$createKeySubmitting ? 'Generating...' : '+ Generate Key'}
          </button>
        </form>

        {#if (app.keys?.length ?? 0) === 0}
          <p class="text-sm text-zinc-400">No keys yet.</p>
        {:else}
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-200 dark:border-zinc-800">
                <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Label</th>
                <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Preview</th>
                <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Created</th>
                <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Last used</th>
                <th class="pb-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
              {#each app.keys ?? [] as key (key.id)}
                <tr class={key.revokedAt ? 'opacity-50' : ''}>
                  <td class="py-2 text-zinc-900 dark:text-zinc-200">{key.label ?? '—'}</td>
                  <td class="py-2 font-mono text-xs text-zinc-500">{key.keyPreview}</td>
                  <td class="py-2 text-xs text-zinc-500">{formatDate(key.createdAt)}</td>
                  <td class="py-2 text-xs text-zinc-500">{formatDate(key.lastUsedAt)}</td>
                  <td class="py-2 text-right">
                    {#if key.revokedAt}
                      <span class="text-xs text-red-500">revoked</span>
                    {:else}
                      <!-- Keep both handlers: onclick updates before client validation for button activation;
                           onsubmit covers keyboard/requestSubmit paths and the confirmation. -->
                      <form method="POST" action="?/revokeKey" use:revokeKeyEnhance
                        onsubmit={(e) => {
                          if (!confirm('Revoke this key? This cannot be undone.')) {
                            e.preventDefault();
                            setRevokeKey('');
                            return;
                          }
                          setRevokeKey(key.id);
                        }}
                        novalidate>
                        <input type="hidden" name="_kind" value="revokeKey" />
                        <input type="hidden" name="keyId" value={key.id} />
                        <button type="submit"
                          disabled={$revokeKeySubmitting}
                          onclick={() => setRevokeKey(key.id)}
                          class="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                          Revoke
                        </button>
                      </form>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <!-- Danger zone -->
      <section class="max-w-lg border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
        <form method="POST" action="?/deleteApp" use:deleteAppEnhance onsubmit={(e) => {
          if (!confirm(`Delete app "${app.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
        }} novalidate>
          <input type="hidden" name="_kind" value="deleteApp" />
          <button type="submit" disabled={$deleteAppSubmitting} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
            Delete app
          </button>
        </form>
      </section>
    </div>
  {/if}

  <!-- ───────────── CLIENT TAB (non-CHATBOT) ───────────── -->
  {#if activeTab === 'client'}
    <div class="max-w-2xl space-y-8">
      <!-- Active client keys -->
      <section>
        <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">
          Client Keys
          <span class="ml-1 text-sm font-normal text-zinc-500">({activeKeys.length})</span>
        </h2>
        {#if activeKeys.length}
          <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each activeKeys as key (key.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="text-base">🔑</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{key.label ?? 'Unnamed key'}</p>
                  <p class="font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">{maskedKey(key.label, key.createdAt, key.keyPreview)}</p>
                  <p class="text-xs text-zinc-400">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {#if key.lastUsedAt}
                      · Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                    {:else}
                      · Never used
                    {/if}
                  </p>
                </div>
                <!-- Keep both handlers: onclick updates before client validation for button activation;
                     onsubmit covers keyboard/requestSubmit paths and the confirmation. -->
                <form method="POST" action="?/revokeKey" use:revokeKeyEnhance onsubmit={(e) => {
                  if (!confirm(`Revoke key "${key.label ?? 'Unnamed key'}"? It will stop working immediately.`)) {
                    e.preventDefault();
                    setRevokeKey('');
                    return;
                  }
                  setRevokeKey(key.id);
                }} novalidate>
                  <input type="hidden" name="_kind" value="revokeKey" />
                  <input type="hidden" name="keyId" value={key.id} />
                  <button type="submit" disabled={$revokeKeySubmitting} onclick={() => setRevokeKey(key.id)} class="text-xs text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50">Revoke</button>
                </form>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-zinc-500">No active keys. Create one below to get started.</p>
        {/if}
      </section>

      <!-- New Client Key -->
      <section>
        {#if activeKeys.length > 0}
          <button onclick={() => newKeySectionOpen = !newKeySectionOpen} class="mb-3 flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {newKeySectionOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
            New Client Key
          </button>
        {:else}
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">New Client Key</h2>
        {/if}
        {#if !activeKeys.length || newKeySectionOpen}
          <div class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <label for="keyLabel" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input id="keyLabel" type="text" bind:value={newKeyLabel} placeholder="e.g. Project A, Alice's laptop"
                class="w-full rounded-lg border px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
                  {duplicateKeyName ? 'border-red-400 focus:border-red-500 dark:border-red-600' : 'border-zinc-300 focus:border-indigo-500 dark:border-zinc-700'}" />
              {#if duplicateKeyName}
                <p class="mt-1 text-xs text-red-400">A key with this name already exists.</p>
              {/if}
              {#if keyPreviewText}
                <p class="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">{keyPreviewText}</p>
              {/if}
            </div>

            <div>
              <span class="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Include plugins</span>
              <form method="POST" action="?/updateAgentTools" use:updateAgentToolsEnhance
                novalidate
                bind:this={agentToolsForm}>
                <input type="hidden" name="_kind" value="updateAgentTools" />
                {#each [...selectedTools] as tool}
                  <input type="hidden" name="agentTools" value={tool} />
                {/each}
                <div class="grid grid-cols-2 gap-2">
                  {#each AGENT_TOOL_OPTIONS as tool (tool.value)}
                    <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" checked={selectedTools.has(tool.value)} onclick={() => toggleTool(tool.value)}
                        class="rounded border-zinc-300 bg-white text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                      {tool.label}
                      {#if tool.scope === 'global'}
                        <span class="text-[10px] text-zinc-400">(global)</span>
                      {/if}
                    </label>
                  {/each}
                </div>
              </form>
            </div>

            <div class="flex items-center gap-4">
              <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Client mode:</span>
              <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input type="radio" name="clientMode" checked={withClientApp} onchange={() => { withClientApp = true; }} class="text-indigo-500 focus:ring-indigo-500" />
                With Client App
              </label>
              <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input type="radio" name="clientMode" checked={!withClientApp} onchange={() => { withClientApp = false; }} class="text-indigo-500 focus:ring-indigo-500" />
                Direct
              </label>
            </div>

            <button onclick={downloadSetupZip} disabled={downloading || !canDownload}
              class="w-full rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? 'Generating...' : 'Download setup files (.zip)'}
            </button>
            <p class="text-[10px] text-zinc-400">Creates a new client key and downloads a zip with the selected plugin configs. Extract in your project root.</p>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>
