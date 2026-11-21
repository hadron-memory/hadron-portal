<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { deserialize } from '$app/forms';
  import { signinRedirectLocation } from '$lib/forms/signin-redirect';
  import { goto } from '$app/navigation';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ConversationCanvas from '$lib/components/flow/ConversationCanvas.svelte';
  import ConversationEdgePanel from '$lib/components/flow/ConversationEdgePanel.svelte';
  import ConversationInfoPanel from '$lib/components/flow/ConversationInfoPanel.svelte';
  import ConversationStagePanel from '$lib/components/flow/ConversationStagePanel.svelte';
  import {
    buildConversationCanvas,
    buildConversationEdgeDetails,
    conversationEdgeInputsFromNodes,
    isConversationLoc,
    isStageLoc,
    orderedStages,
  } from '$lib/flow/conversation-canvas';
  import { addStageSchema } from '$lib/flow/conversation-add-stage-form';
  import { conversationEdgePanelSchema } from '$lib/flow/conversation-edge-panel-form';
  import { conversationEntryConditionSchema } from '$lib/flow/conversation-entry-condition-form';
  import { conversationGoalsSchema } from '$lib/flow/conversation-goals-form';
  import { conversationMoveSchema } from '$lib/flow/conversation-move-form';
  import { conversationPromptSchema } from '$lib/flow/conversation-prompt-form';
  import { conversationStageExtractionSchema } from '$lib/flow/conversation-stage-extraction-form';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import PartialPromptForm from './PartialPromptForm.svelte';
  import { addConversationSchema, addEdgeSchema } from './schema';

  type AddConversationForm = Infer<typeof addConversationSchema, 'zod4'>;
  type AddEdgeForm = Infer<typeof addEdgeSchema, 'zod4'>;
  type AddStageForm = Infer<typeof addStageSchema, 'zod4'>;
  type ConversationEdgePanelForm = Infer<typeof conversationEdgePanelSchema, 'zod4'>;
  type ConversationGoalsForm = Infer<typeof conversationGoalsSchema, 'zod4'>;
  type ConversationEntryConditionForm = Infer<typeof conversationEntryConditionSchema, 'zod4'>;
  type ConversationMoveForm = Infer<typeof conversationMoveSchema, 'zod4'>;
  type ConversationPromptForm = Infer<typeof conversationPromptSchema, 'zod4'>;
  type ConversationStageExtractionForm = Infer<typeof conversationStageExtractionSchema, 'zod4'>;
  type AddEdgeSuperform = SuperValidated<AddEdgeForm, App.Superforms.Message, AddEdgeForm>;
  type AddConversationActionResult = {
    form?: SuperValidated<AddConversationForm, App.Superforms.Message, AddConversationForm>;
  } | null;
  type AddEdgeActionResult = {
    form?: SuperValidated<AddEdgeForm, App.Superforms.Message, AddEdgeForm>;
  } | null;
  type AddStageActionResult = {
    form?: SuperValidated<AddStageForm, App.Superforms.Message, AddStageForm>;
  } | null;
  type UpdateEdgeActionResult = {
    form?: SuperValidated<ConversationEdgePanelForm, App.Superforms.Message, ConversationEdgePanelForm>;
  } | null;
  type UpdateExtractionSpecActionResult = {
    form?: SuperValidated<ConversationStageExtractionForm, App.Superforms.Message, ConversationStageExtractionForm>;
  } | null;
  type UpdateGoalsActionResult = {
    form?: SuperValidated<ConversationGoalsForm, App.Superforms.Message, ConversationGoalsForm>;
  } | null;
  type UpdateEntryConditionActionResult = {
    form?: SuperValidated<ConversationEntryConditionForm, App.Superforms.Message, ConversationEntryConditionForm>;
  } | null;
  type MoveConversationActionResult = {
    form?: SuperValidated<ConversationMoveForm, App.Superforms.Message, ConversationMoveForm>;
  } | null;
  type UpdatePromptActionResult = {
    form?: SuperValidated<ConversationPromptForm, App.Superforms.Message, ConversationPromptForm>;
  } | null;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);
  // This page 404s without an org (loader), so org is always present here — the
  // "Agents" breadcrumb targets the org grid (#647: /app/agents is now the
  // personal list, not an org-member redirector).
  const org = $derived(data.org);

  // ── Revisions + Lock ──
  type Revision = { loc: string; label: string; description: string | null; published: boolean; revision: number; createdAt: string | null };
  let revisions = $state<Revision[]>([]);
  let revisionsLoading = $state(false);
  // Whether the list has loaded at least once; the Start section's publish note
  // needs to know, and an unloaded list must not read as "nothing published".
  let revisionsLoaded = $state(false);
  let revisionsBusy = $state(false);
  let revisionError = $state<string | null>(null);
  let showRevisions = $state(false);
  let publishLabel = $state('');

  async function loadRevisions() {
    revisionsLoading = true;
    try {
      const res = await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', agentId: agent.id }),
      });
      const body = await res.json();
      revisions = body.revisions ?? [];
      revisionsLoaded = Array.isArray(body.revisions);
    } catch { /* ignore */ }
    revisionsLoading = false;
  }

  async function saveRevision() {
    revisionsBusy = true;
    revisionError = null;
    try {
      const res = await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', agentId: agent.id, description: `Manual save` }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      await loadRevisions();
    } catch (e) {
      revisionError = e instanceof Error ? e.message : 'Failed to save';
    }
    revisionsBusy = false;
  }

  async function publishRevision(revLoc: string) {
    const label = publishLabel.trim() || undefined;
    revisionsBusy = true;
    revisionError = null;
    try {
      const res = await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', agentId: agent.id, revisionLoc: revLoc, versionLabel: label }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      publishLabel = '';
      await loadRevisions();
    } catch (e) {
      revisionError = e instanceof Error ? e.message : 'Failed to publish';
    }
    revisionsBusy = false;
  }

  async function restoreRevision(revLoc: string) {
    if (!confirm(`Restore to ${revLoc}? Current state will be auto-saved first.`)) return;
    revisionsBusy = true;
    revisionError = null;
    try {
      const res = await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', agentId: agent.id, revisionLoc: revLoc }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      window.location.reload();
    } catch (e) {
      revisionError = e instanceof Error ? e.message : 'Failed to restore';
    }
    revisionsBusy = false;
  }

  // The Start section's publish note depends on it, so read it up front.
  onMount(() => { loadRevisions(); });
  const publishState = $derived<'yes' | 'no' | 'unknown'>(
    !revisionsLoaded ? 'unknown' : revisions.some((r) => r.published) ? 'yes' : 'no',
  );

  // ── Editor Lock ──
  let lockOwned = $state(false);
  let lockBlockedBy = $state<string | null>(null);
  let lockExpiresAt = $state<string | null>(null);
  let lockRenewTimer: ReturnType<typeof setInterval> | undefined;

  async function acquireLock() {
    try {
      const res = await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock', agentId: agent.id }),
      });
      const body = await res.json();
      if (body.locked) {
        lockOwned = true;
        lockBlockedBy = null;
        lockExpiresAt = body.expiresAt;
      } else {
        lockOwned = false;
        lockBlockedBy = body.lockedBy ?? 'another user';
        lockExpiresAt = body.expiresAt;
      }
    } catch { /* ignore */ }
  }

  async function releaseLock() {
    if (!lockOwned) return;
    try {
      await fetch('/api/agent-chat/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', agentId: agent.id }),
      });
    } catch { /* ignore */ }
    lockOwned = false;
  }

  // Acquire lock on mount, renew every 4 minutes, release on leave
  $effect(() => {
    acquireLock();
    lockRenewTimer = setInterval(acquireLock, 4 * 60 * 1000);
    return () => {
      if (lockRenewTimer) clearInterval(lockRenewTimer);
      releaseLock();
    };
  });

  // ── Canvas model (derived against the CURRENT load payload, so saves that
  // invalidate the load re-render the graph) ──
  const edgeInputs = $derived(conversationEdgeInputsFromNodes(data.systemNodes));
  const canvasModel = $derived(buildConversationCanvas(data.systemNodes, edgeInputs));
  const edgeDetails = $derived(buildConversationEdgeDetails(data.systemNodes, edgeInputs));

  let canvasHeight = $state(520);

  // ── Selection → side panel. Derived against the current payload, so a
  // selected element that disappears (deleted, renamed away) closes the
  // panel instead of showing stale data.
  let selectedId = $state<string | null>(null);
  const selectedEdge = $derived(edgeDetails.find((e) => e.id === selectedId) ?? null);
  const selectedNode = $derived(data.systemNodes.find((n) => n.id === selectedId) ?? null);

  const selectedStage = $derived.by(() => {
    const n = selectedNode;
    if (!n || !isStageLoc(n.loc)) return null;
    const d = (n.data as Record<string, unknown>) ?? {};
    const promptRef = typeof d.promptRef === 'string' ? d.promptRef : null;
    return {
      id: n.id,
      loc: n.loc,
      label: n.description || n.name || n.loc,
      promptRef,
      promptContent: promptRef
        ? (data.prompts.find((p) => p.loc === promptRef)?.content ?? '')
        : '',
      extractionSpec: Array.isArray(d.extractionSpec) ? d.extractionSpec : [],
    };
  });
  const selectedStageRules = $derived(
    selectedStage ? edgeDetails.filter((e) => e.sourceId === selectedStage.id) : [],
  );

  const selectedConversation = $derived.by(() => {
    const n = selectedNode;
    if (!n || !isConversationLoc(n.loc)) return null;
    const d = (n.data as Record<string, unknown>) ?? {};
    const stageOrder = Array.isArray(d.stageOrder)
      ? (d.stageOrder as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const stages = orderedStages(
      stageOrder,
      data.systemNodes.filter((s) => isStageLoc(s.loc) && s.loc.startsWith(`${n.loc}:`)),
    );
    const canvasNode = canvasModel.nodes.find((c) => c.id === n.id);
    return {
      id: n.id,
      loc: n.loc,
      label: n.description || n.name || n.loc,
      isSetup: d.isSetup === true,
      isFallback: d.isFallback === true,
      startOrder: canvasNode?.startOrder ?? null,
      startTotal: canvasNode?.startTotal ?? null,
      entryCondition: d.entryCondition ?? null,
      goalDescriptions: Array.isArray(d.goalDescriptions)
        ? (d.goalDescriptions as unknown[]).filter((g): g is string => typeof g === 'string')
        : [],
      goalSignals: Array.isArray(d.goalSignals)
        ? (d.goalSignals as unknown[]).filter((g): g is string => typeof g === 'string')
        : [],
      stages: stages.map((s) => ({ id: s.id, loc: s.loc, label: s.description || s.name || s.loc })),
    };
  });

  // `form` outlives selection changes, so a result is "acknowledged" the
  // moment the user changes the selection — otherwise re-selecting a saved
  // edge would re-show its stale banner. Plain variable: every write
  // co-occurs with a selectedId write, which re-runs the deriveds.
  let acknowledgedForm: ActionData = null;
  function select(id: string | null) {
    if (id !== selectedId) acknowledgedForm = form;
    selectedId = id;
  }

  // updateEdge results are scoped to the edge they were submitted for; the
  // edgeId != null guard keeps edgeId-less results (addEdge failures,
  // missing-edge-id 400s) out of the panel.
  const formIsLive = $derived(form != null && form !== acknowledgedForm);
  const addConversationActionForm = $derived.by(() => {
    const actionForm = (form as AddConversationActionResult)?.form ?? null;
    if (!formIsLive || !actionForm) return null;
    return actionForm.data._kind === 'addConversation' ? actionForm : null;
  });
  const initialAddConversationForm = untrack(() => addConversationActionForm ?? data.addConversationForm);
  const {
    form: addConversationData,
    errors: addConversationErrors,
    message: addConversationMessage,
    enhance: addConversationEnhance,
    submitting: addConversationSubmitting,
  } = superForm<AddConversationForm, App.Superforms.Message, AddConversationForm>(
    initialAddConversationForm,
    {
      validators: zod4Client(addConversationSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      clearOnSubmit: 'none',
      resetForm: true,
    },
  );
  const addConversationError = $derived(
    $addConversationMessage?.type === 'error'
      ? $addConversationMessage.text
      : ($addConversationErrors.systemMemoryId?.[0] ?? null),
  );
  const addConversationSaved = $derived(
    $addConversationMessage?.type === 'success' ? $addConversationMessage.text : null,
  );
  const addStageForm = $derived.by(() => {
    const actionForm = (form as AddStageActionResult)?.form ?? null;
    if (!formIsLive || !actionForm) return null;
    return actionForm.data._kind === 'addStage' ? actionForm : null;
  });
  const addEdgeActionForm = $derived.by(() => {
    const actionForm = (form as AddEdgeActionResult)?.form ?? null;
    if (!formIsLive || !actionForm) return null;
    return actionForm.data._kind === 'addEdge' ? actionForm : null;
  });
  const addEdgeError = $derived.by(() => {
    if (!addEdgeActionForm) return null;
    if (addEdgeActionForm.message?.type === 'error') return addEdgeActionForm.message.text;
    return addEdgeActionForm.errors.sourceNodeId?.[0]
      ?? addEdgeActionForm.errors.targetNodeId?.[0]
      ?? addEdgeActionForm.errors.condition?.[0]
      ?? addEdgeActionForm.errors.priority?.[0]
      ?? addEdgeActionForm.errors.data?.[0]
      ?? null;
  });
  const initialAddEdgeForm = untrack(() => addEdgeActionForm as AddEdgeSuperform | null ?? data.addEdgeForm);
  const {
    form: addEdgeData,
    enhance: addEdgeEnhance,
    submitting: addEdgeSubmitting,
  } = superForm<AddEdgeForm, App.Superforms.Message, AddEdgeForm>(initialAddEdgeForm, {
    validators: zod4Client(addEdgeSchema),
    validationMethod: 'onsubmit',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    invalidateAll: true,
    clearOnSubmit: 'none',
    resetForm: true,
    onResult({ result }) {
      connectPending = false;
      if (result.type === 'success' && typeof result.data?.edgeId === 'string') {
        // Direct assignment (not select): the addEdge result must stay
        // live so the freshly opened panel reflects it.
        selectedId = result.data.edgeId;
      }
    },
  });
  const plainActionError = $derived.by(() => {
    if (!formIsLive || !form || !('error' in form)) return null;
    return typeof form.error === 'string' ? form.error : null;
  });
  const updateForm = $derived.by(() => {
    const actionForm = (form as UpdateEdgeActionResult)?.form ?? null;
    return actionForm?.data._kind === 'updateEdge' ? actionForm : null;
  });
  const edgePanelSaved = $derived.by(() => {
    if (!formIsLive || !updateForm) return false;
    return updateForm.message?.type === 'success' && updateForm.data?.edgeId === selectedEdge?.id;
  });
  const edgePanelError = $derived.by(() => {
    if (!formIsLive || !updateForm) return null;
    return updateForm.message?.type === 'error' && updateForm.data?.edgeId === selectedEdge?.id
      ? updateForm.message.text
      : null;
  });
  const selectedEdgeForm = $derived.by(() => {
    if (!selectedEdge) return null;
    return formIsLive && updateForm?.data?.edgeId === selectedEdge.id
      ? updateForm
      : data.edgeForms[selectedEdge.id];
  });
  const extractionForm = $derived.by(() => {
    const actionForm = (form as UpdateExtractionSpecActionResult)?.form ?? null;
    return actionForm?.data._kind === 'updateExtractionSpec' ? actionForm : null;
  });
  const stageExtractionSaved = $derived.by(() => {
    if (!formIsLive || !extractionForm) return null;
    return extractionForm.message?.type === 'success' && extractionForm.data?.stageLoc === selectedStage?.loc
      ? extractionForm.message.text
      : null;
  });
  const stageExtractionError = $derived.by(() => {
    if (!formIsLive || !extractionForm) return null;
    return extractionForm.message?.type === 'error' && extractionForm.data?.stageLoc === selectedStage?.loc
      ? extractionForm.message.text
      : null;
  });
  const selectedStageExtractionForm = $derived.by(() => {
    if (!selectedStage) return null;
    // Load-time forms are keyed by node id; action echoes scope by stageLoc,
    // the identifier the server receives from the submitted form.
    return formIsLive && extractionForm?.data?.stageLoc === selectedStage.loc
      ? extractionForm
      : data.stageExtractionForms[selectedStage.id];
  });
  const promptForm = $derived.by(() => {
    const actionForm = (form as UpdatePromptActionResult)?.form ?? null;
    if (!formIsLive || !actionForm) return null;
    return actionForm.data._kind === 'updatePrompt' ? actionForm : null;
  });
  const stagePromptSaved = $derived.by(() => {
    if (!formIsLive || !promptForm) return null;
    return promptForm.message?.type === 'success' && promptForm.data?.loc === selectedStage?.promptRef
      ? promptForm.message.text
      : null;
  });
  const stagePromptError = $derived.by(() => {
    if (!formIsLive || !promptForm) return null;
    return promptForm.message?.type === 'error' && promptForm.data?.loc === selectedStage?.promptRef
      ? promptForm.message.text
      : null;
  });
  const selectedStagePromptForm = $derived.by(() => {
    if (!selectedStage?.promptRef) return null;
    return formIsLive && promptForm?.data?.loc === selectedStage.promptRef
      ? promptForm
      : (data.promptForms[selectedStage.promptRef] ?? null);
  });
  const goalsForm = $derived.by(() => {
    const actionForm = (form as UpdateGoalsActionResult)?.form ?? null;
    return actionForm?.data._kind === 'updateGoals' ? actionForm : null;
  });
  const conversationGoalsSaved = $derived.by(() => {
    if (!formIsLive || !goalsForm) return null;
    return goalsForm.message?.type === 'success' && goalsForm.data?.convLoc === selectedConversation?.loc
      ? goalsForm.message.text
      : null;
  });
  const conversationGoalsError = $derived.by(() => {
    if (!formIsLive || !goalsForm) return null;
    return goalsForm.message?.type === 'error' && goalsForm.data?.convLoc === selectedConversation?.loc
      ? goalsForm.message.text
      : null;
  });
  const selectedConversationGoalsForm = $derived.by(() => {
    if (!selectedConversation) return null;
    // Load-time forms are keyed by node id; action echoes scope by convLoc,
    // the identifier the server receives from the submitted form.
    return formIsLive && goalsForm?.data?.convLoc === selectedConversation.loc
      ? goalsForm
      : data.conversationGoalForms[selectedConversation.id];
  });
  // S7 Start section. Results are matched by _kind AND the conversation's loc, so
  // another conversation's late result never banners or seeds this one.
  const startConditionActionForm = $derived.by(() => {
    const actionForm = (form as UpdateEntryConditionActionResult)?.form ?? null;
    return actionForm?.data._kind === 'updateEntryCondition' ? actionForm : null;
  });
  const moveActionForm = $derived.by(() => {
    const actionForm = (form as MoveConversationActionResult)?.form ?? null;
    return actionForm?.data._kind === 'moveConversation' ? actionForm : null;
  });
  const startConditionSaved = $derived.by(() => {
    if (!formIsLive || !startConditionActionForm) return null;
    return startConditionActionForm.message?.type === 'success' && startConditionActionForm.data?.convLoc === selectedConversation?.loc
      ? startConditionActionForm.message.text
      : null;
  });
  const startConditionError = $derived.by(() => {
    if (!formIsLive || !startConditionActionForm) return null;
    return startConditionActionForm.message?.type === 'error' && startConditionActionForm.data?.convLoc === selectedConversation?.loc
      ? startConditionActionForm.message.text
      : null;
  });
  const moveError = $derived.by(() => {
    if (!formIsLive || !moveActionForm) return null;
    return moveActionForm.message?.type === 'error' && moveActionForm.data?.convLoc === selectedConversation?.loc
      ? moveActionForm.message.text
      : null;
  });
  // Seeds stay the load-time forms: a result echoes the posted values, and the
  // panel keeps its own state after a save.
  const selectedConversationStartForms = $derived(
    selectedConversation ? data.conversationStartForms[selectedConversation.id] ?? null : null,
  );
  const conversationAddStageSaved = $derived.by(() => {
    if (!formIsLive || !addStageForm) return null;
    return addStageForm.message?.type === 'success' && addStageForm.data?.conversationLoc === selectedConversation?.loc
      ? addStageForm.message.text
      : null;
  });
  const conversationAddStageError = $derived.by(() => {
    if (!formIsLive || !addStageForm) return null;
    return addStageForm.message?.type === 'error' && addStageForm.data?.conversationLoc === selectedConversation?.loc
      ? addStageForm.message.text
      : null;
  });
  const selectedConversationAddStageForm = $derived.by(() => {
    if (!selectedConversation) return null;
    // Load-time forms are keyed by node id; action echoes scope by conversationLoc,
    // the identifier the server receives from the submitted form.
    return formIsLive && addStageForm?.data?.conversationLoc === selectedConversation.loc
      ? addStageForm
      : data.addStageForms[selectedConversation.id];
  });

  // ── Drag-to-connect: SvelteFlow's connection fills this hidden form, which
  // posts to the addEdge action; on success the new rule is selected so its
  // timing/condition can be refined right away.
  let connectForm: HTMLFormElement | undefined = $state();
  let connectPending = $state(false);

  async function handleConnect(sourceId: string, targetId: string) {
    // connectPending guards the pre-submit setup window; $addEdgeSubmitting
    // takes over once the submit event reaches Superforms' enhance handler.
    if (connectPending || $addEdgeSubmitting || sourceId === targetId) return;
    // Claimed HERE, not in the enhance callback — the await below yields, and
    // a second connect in that window would overwrite the form fields.
    connectPending = true;
    const target = data.systemNodes.find((n) => n.id === targetId);
    const connectName = `→ ${target?.description || target?.name || t('conversation.editor.connect.next', 'next')}`;
    // Rules fire in ascending priority and the new rule has no condition, so
    // at the sources' current minimum it would shadow every existing sibling
    // (fall-through wins first). Land it after them instead; the panel opens
    // for refinement anyway.
    const siblings = edgeDetails.filter((e) => e.sourceId === sourceId);
    const connectPriority =
      siblings.length > 0 ? Math.max(...siblings.map((e) => e.priority ?? 0)) + 1 : 0;
    addEdgeData.update((current) => ({
      ...current,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      name: connectName,
      condition: 'null',
      priority: String(connectPriority),
      data: JSON.stringify({ timing: 'on_complete', behavior: 'transition' }),
    }), { taint: false });
    await tick();
    connectForm?.requestSubmit();
  }

  // ── Position persistence: fire-and-forget on drag stop. No invalidation —
  // the canvas already shows the dragged position; the save only matters for
  // the next load.
  function handleNodeMoved(nodeId: string, x: number, y: number) {
    const node = data.systemNodes.find((n) => n.id === nodeId);
    if (!node) return;
    const fd = new FormData();
    fd.set('systemMemoryId', data.systemMemoryId);
    fd.set('loc', node.loc);
    fd.set('x', String(Math.round(x)));
    fd.set('y', String(Math.round(y)));
    fetch('?/savePosition', {
      method: 'POST',
      body: fd,
      headers: { 'x-sveltekit-action': 'true' },
    })
      // #974: an expired session answers with a sign-in redirect. A dragged
      // position is all this carries, so following it loses nothing typed.
      .then(async (res) => {
        const signin = signinRedirectLocation(deserialize(await res.text()));
        if (signin) await goto(signin);
      })
      .catch((err) => console.warn('[conversation-canvas] position save failed:', err));
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  const partials = $derived(data.prompts.filter((p) => p.loc.startsWith('prompts:partials:')));
  let editingPartial = $state<string | null>(null);
  function partialPromptFormFor(loc: string) {
    return formIsLive && promptForm?.data?.loc === loc ? promptForm : data.promptForms[loc];
  }
</script>

<svelte:head><title>Conversations · {agent.name} · Hadron</title></svelte:head>

<div class="flex h-full min-h-0 flex-col space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Agents', href: `/app/orgs/${org.id}/agents` },
      { label: agent.name, href: `/app/agents/${agent.id}` },
      { label: 'Conversations' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
      {t('conversation.editor.title', 'Conversation Editor')}
    </h1>
    <p class="mt-1 text-sm text-zinc-500">
      {t('conversation.editor.intro', 'Design conversation flows for')} {agent.name} —
      {t(
        'conversation.editor.hint',
        'click a conversation, stage, or rule to edit it; drag between node handles to add a routing rule; drag nodes to arrange the canvas.',
      )}
    </p>
  </div>

  <!-- #2092: wrap authoring controls within the page; never clip or hide an action. -->
  <div data-testid="conversation-toolbar" class="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
    <!-- Lock indicator -->
    {#if lockBlockedBy}
      <div class="flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
        <svg class="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span class="min-w-0 break-words">Locked by {lockBlockedBy}</span>
      </div>
    {:else if lockOwned}
      <div class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Editing
      </div>
    {/if}

    <div class="flex-1"></div>

    <!-- Add conversation -->
    <div class="flex min-w-0 max-w-full flex-col items-start gap-1">
      <form method="POST" action="?/addConversation" use:addConversationEnhance class="flex max-w-full flex-wrap items-center gap-1" novalidate>
        <input type="hidden" name="systemMemoryId" bind:value={$addConversationData.systemMemoryId} />
        <input
          type="text"
          name="name"
          bind:value={$addConversationData.name}
          placeholder={t('conversation.editor.addConversation.placeholder', 'New conversation…')}
          aria-label={t('conversation.editor.addConversation.placeholder', 'New conversation…')}
          aria-invalid={$addConversationErrors.name?.[0] ? 'true' : undefined}
          aria-describedby={$addConversationErrors.name?.[0] ? 'add-conversation-name-error' : undefined}
          class="min-h-11 w-44 max-w-full rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={!$addConversationData.name.trim() || $addConversationSubmitting}
          class="min-h-11 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          style="background: #219ebc;"
        >
          {$addConversationSubmitting
            ? t('conversation.editor.addConversation.saving', 'Adding...')
            : t('conversation.editor.addConversation', '+ Conversation')}
        </button>
      </form>
      {#if $addConversationErrors.name?.[0]}
        <span id="add-conversation-name-error" class="text-xs text-red-600 dark:text-red-400">{$addConversationErrors.name[0]}</span>
      {:else if addConversationError}
        <span role="alert" class="text-xs text-red-600 dark:text-red-400">{addConversationError}</span>
      {/if}
      <LiveRegion class="idle:absolute">
        {#if !$addConversationErrors.name?.[0] && !addConversationError && addConversationSaved}
          <span class="text-xs text-green-600 dark:text-green-400">{addConversationSaved}</span>
        {/if}
      </LiveRegion>
    </div>

    <button type="button" onclick={saveRevision} disabled={revisionsBusy || !!lockBlockedBy}
      class="min-h-11 shrink-0 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
      Save revision
    </button>
    <button type="button" onclick={() => { showRevisions = !showRevisions; if (showRevisions && revisions.length === 0) loadRevisions(); }}
      class="min-h-11 shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
      {showRevisions ? 'Hide revisions' : 'Revisions'}
    </button>
    {#if revisionError}
      <span class="min-w-0 break-words text-xs text-red-500">{revisionError}</span>
    {/if}
  </div>

  {#if showRevisions}
    <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      <div class="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">Revisions</h2>
      </div>
      {#if revisionsLoading}
        <div class="px-5 py-4 text-sm text-zinc-400">Loading...</div>
      {:else if revisions.length === 0}
        <div class="px-5 py-4 text-sm text-zinc-400">No revisions yet. Click "Save revision" to create one.</div>
      {:else}
        <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
          {#each revisions as rev}
            <div class="flex items-center justify-between px-5 py-3">
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{rev.label}</span>
                {#if rev.published}
                  <span class="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">published</span>
                {/if}
                {#if rev.description}
                  <span class="ml-2 text-xs text-zinc-400">{rev.description}</span>
                {/if}
                {#if rev.createdAt}
                  <span class="ml-2 text-xs text-zinc-400">{new Date(rev.createdAt).toLocaleDateString()}</span>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if !rev.published}
                  <div class="flex items-center gap-1">
                    <input type="text" bind:value={publishLabel} placeholder="version label" class="w-24 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    <button type="button" onclick={() => publishRevision(rev.loc)} disabled={revisionsBusy}
                      class="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                      Publish
                    </button>
                  </div>
                {/if}
                <button type="button" onclick={() => restoreRevision(rev.loc)} disabled={revisionsBusy}
                  class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50">
                  Restore
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Drag-to-connect and remaining native-form failures surface here. -->
  {#if addEdgeError || plainActionError}
    <div
      role="alert"
      class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      {addEdgeError ?? plainActionError}
    </div>
  {/if}

  <!-- Canvas + side panel. SvelteFlow needs a definite pixel height: its
       height:100% resolves to 0 through this flex/min-height chain, so
       measure the box and pass px down. -->
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row"
    style="height: calc(100vh - 330px); min-height: 480px;"
  >
    <div
      bind:clientHeight={canvasHeight}
      class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
    >
      {#if canvasModel.nodes.length === 0}
        <div class="flex h-full items-center justify-center text-sm text-zinc-400">
          {t(
            'conversation.editor.empty',
            'No conversations yet — add one with “+ Conversation” above.',
          )}
        </div>
      {:else}
        <ConversationCanvas
          model={canvasModel}
          height={canvasHeight}
          selectedId={selectedEdge?.id ?? selectedNode?.id ?? null}
          onSelect={select}
          onConnect={handleConnect}
          onNodeMoved={handleNodeMoved}
        />
      {/if}
    </div>
    {#if selectedEdge && selectedEdgeForm}
      {#key selectedEdge.id}
        <ConversationEdgePanel
          edge={selectedEdge}
          form={selectedEdgeForm}
          saved={edgePanelSaved}
          error={edgePanelError}
          onClose={() => select(null)}
        />
      {/key}
    {:else if selectedStage && selectedStageExtractionForm}
      {#key selectedStage.id}
        <ConversationStagePanel
          stage={selectedStage}
          promptForm={selectedStagePromptForm}
          promptSaved={stagePromptSaved}
          promptError={stagePromptError}
          extractionForm={selectedStageExtractionForm}
          extractionSaved={stageExtractionSaved}
          extractionError={stageExtractionError}
          rules={selectedStageRules}
          systemMemoryId={data.systemMemoryId}
          onClose={() => select(null)}
          onSelectEdge={select}
        />
      {/key}
    {:else if selectedConversation && selectedConversationGoalsForm && selectedConversationAddStageForm && selectedConversationStartForms}
      {#key selectedConversation.id}
        <ConversationInfoPanel
          conversation={selectedConversation}
          goalsForm={selectedConversationGoalsForm}
          goalsSaved={conversationGoalsSaved}
          goalsError={conversationGoalsError}
          addStageForm={selectedConversationAddStageForm}
          addStageSaved={conversationAddStageSaved}
          addStageError={conversationAddStageError}
          startConditionForm={selectedConversationStartForms.condition}
          {startConditionSaved}
          {startConditionError}
          moveForm={selectedConversationStartForms.move}
          {moveError}
          {publishState}
          onClose={() => select(null)}
          onSelectNode={select}
        />
      {/key}
    {/if}
  </div>

  <!-- Hidden drag-to-connect form: posts the new routing rule, then selects it. -->
  <form
    bind:this={connectForm}
    method="POST"
    action="?/addEdge"
    class="hidden"
    use:addEdgeEnhance
    novalidate
  >
    <input type="hidden" name="_kind" bind:value={$addEdgeData._kind} />
    <input type="hidden" name="sourceNodeId" bind:value={$addEdgeData.sourceNodeId} />
    <input type="hidden" name="targetNodeId" bind:value={$addEdgeData.targetNodeId} />
    <input type="hidden" name="name" bind:value={$addEdgeData.name} />
    <input type="hidden" name="condition" bind:value={$addEdgeData.condition} />
    <input type="hidden" name="priority" bind:value={$addEdgeData.priority} />
    <input type="hidden" name="data" bind:value={$addEdgeData.data} />
  </form>

  <!-- Shared partials -->
  {#if partials.length > 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">
        {t('conversation.editor.partials', 'Shared Partials')}
      </h2>
      <div class="space-y-2">
        {#each partials as partial (partial.id)}
          {@const partialForm = partialPromptFormFor(partial.loc)}
          <div class="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{partial.loc}</span>
              <button onclick={() => { editingPartial = partial.loc; }}
                class="text-xs text-indigo-500 hover:underline">
                {t('conversation.editor.partials.edit', 'Edit')}
              </button>
            </div>
            {#if editingPartial === partial.loc && partialForm}
              <PartialPromptForm
                form={partialForm}
                onCancel={() => editingPartial = null}
                onSaved={() => editingPartial = null}
              />
            {:else if partial.content}
              <pre class="mt-1 max-h-16 overflow-y-auto text-xs text-zinc-500">{partial.content.slice(0, 200)}{(partial.content?.length ?? 0) > 200 ? '...' : ''}</pre>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
