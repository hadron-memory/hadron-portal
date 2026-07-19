<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ConversationCanvas from '$lib/components/flow/ConversationCanvas.svelte';
  import ConversationEdgePanel from '$lib/components/flow/ConversationEdgePanel.svelte';
  import ConversationInfoPanel from '$lib/components/flow/ConversationInfoPanel.svelte';
  import ConversationStagePanel from '$lib/components/flow/ConversationStagePanel.svelte';
  import {
    buildConversationCanvas,
    buildConversationEdgeDetails,
    isConversationLoc,
    isStageLoc,
    orderedStages,
  } from '$lib/flow/conversation-canvas';
  import type { ConversationGraphEdgeInput } from '$lib/flow/conversation-canvas';
  import { conversationEdgePanelSchema } from '$lib/flow/conversation-edge-panel-form';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';

  type ConversationEdgePanelForm = Infer<typeof conversationEdgePanelSchema, 'zod4'>;
  type UpdateEdgeActionResult = {
    form?: SuperValidated<ConversationEdgePanelForm, App.Superforms.Message, ConversationEdgePanelForm>;
  } | null;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);

  // ── Revisions + Lock ──
  type Revision = { loc: string; label: string; description: string | null; published: boolean; revision: number; createdAt: string | null };
  let revisions = $state<Revision[]>([]);
  let revisionsLoading = $state(false);
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
  const edgeInputs = $derived.by(() => {
    const edges: ConversationGraphEdgeInput[] = [];
    for (const n of data.systemNodes) {
      for (const e of n.outgoingEdges ?? []) {
        if (!e.target) continue;
        edges.push({
          id: e.id,
          name: e.name,
          sourceId: n.id,
          targetId: e.target.id,
          priority: e.priority ?? null,
          condition: e.condition ?? null,
          data: e.data ?? {},
        });
      }
    }
    return edges;
  });
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
    return {
      id: n.id,
      loc: n.loc,
      label: n.description || n.name || n.loc,
      isSetup: d.isSetup === true,
      isFallback: d.isFallback === true,
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
  const updateForm = $derived((form as UpdateEdgeActionResult)?.form ?? null);
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

  // ── Drag-to-connect: SvelteFlow's connection fills this hidden form, which
  // posts to the addEdge action; on success the new rule is selected so its
  // timing/condition can be refined right away.
  let connectSourceId = $state('');
  let connectTargetId = $state('');
  let connectName = $state('');
  let connectPriority = $state(0);
  let connectForm: HTMLFormElement | undefined = $state();
  let connectPending = $state(false);

  async function handleConnect(sourceId: string, targetId: string) {
    if (connectPending || sourceId === targetId) return;
    // Claimed HERE, not in the enhance callback — the await below yields, and
    // a second connect in that window would overwrite the form fields.
    connectPending = true;
    const target = data.systemNodes.find((n) => n.id === targetId);
    connectSourceId = sourceId;
    connectTargetId = targetId;
    connectName = `→ ${target?.description || target?.name || t('conversation.editor.connect.next', 'next')}`;
    // Rules fire in ascending priority and the new rule has no condition, so
    // at the sources' current minimum it would shadow every existing sibling
    // (fall-through wins first). Land it after them instead; the panel opens
    // for refinement anyway.
    const siblings = edgeDetails.filter((e) => e.sourceId === sourceId);
    connectPriority =
      siblings.length > 0 ? Math.max(...siblings.map((e) => e.priority ?? 0)) + 1 : 0;
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
    }).catch((err) => console.warn('[conversation-canvas] position save failed:', err));
  }

  // ── Add conversation ──
  let newConversationName = $state('');

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  const partials = $derived(data.prompts.filter((p) => p.loc.startsWith('prompts:partials:')));
  let editingPartial = $state<string | null>(null);
  let partialContents = $state<Record<string, string>>({});
</script>

<svelte:head><title>Conversations · {agent.name} · Hadron</title></svelte:head>

<div class="flex h-full min-h-0 flex-col space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Agents', href: '/app/agents' },
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

  <!-- Revisions toolbar -->
  <div class="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
    <!-- Lock indicator -->
    {#if lockBlockedBy}
      <div class="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Locked by {lockBlockedBy}
      </div>
    {:else if lockOwned}
      <div class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Editing
      </div>
    {/if}

    <div class="flex-1"></div>

    <!-- Add conversation -->
    <form method="POST" action="?/addConversation" use:enhance={() => {
      return async ({ update }) => { newConversationName = ''; await update(); };
    }} class="flex items-center gap-1">
      <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
      <input type="text" name="name" bind:value={newConversationName}
        placeholder={t('conversation.editor.addConversation.placeholder', 'New conversation…')}
        aria-label={t('conversation.editor.addConversation.placeholder', 'New conversation…')}
        class="w-44 rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
      <button type="submit" disabled={!newConversationName.trim()}
        class="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" style="background: #219ebc;">
        {t('conversation.editor.addConversation', '+ Conversation')}
      </button>
    </form>

    <button type="button" onclick={saveRevision} disabled={revisionsBusy || !!lockBlockedBy}
      class="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
      Save revision
    </button>
    <button type="button" onclick={() => { showRevisions = !showRevisions; if (showRevisions && revisions.length === 0) loadRevisions(); }}
      class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
      {showRevisions ? 'Hide revisions' : 'Revisions'}
    </button>
    {#if revisionError}
      <span class="text-xs text-red-500">{revisionError}</span>
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

  <!-- Errors not tied to the edge panel (addConversation, addStage, prompt/spec
       saves, addEdge failures) surface here. -->
  {#if formIsLive && form?.error != null && !edgePanelError}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {form.error}
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
    {:else if selectedStage}
      {#key selectedStage.id}
        <ConversationStagePanel
          stage={selectedStage}
          rules={selectedStageRules}
          systemMemoryId={data.systemMemoryId}
          onClose={() => select(null)}
          onSelectEdge={select}
        />
      {/key}
    {:else if selectedConversation}
      {#key selectedConversation.id}
        <ConversationInfoPanel
          conversation={selectedConversation}
          systemMemoryId={data.systemMemoryId}
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
    use:enhance={() => {
      connectPending = true;
      return async ({ result, update }) => {
        await update();
        connectPending = false;
        if (result.type === 'success' && typeof result.data?.edgeId === 'string') {
          // Direct assignment (not select): the addEdge result must stay
          // live so the freshly opened panel reflects it.
          selectedId = result.data.edgeId;
        }
      };
    }}
  >
    <input type="hidden" name="sourceNodeId" value={connectSourceId} />
    <input type="hidden" name="targetNodeId" value={connectTargetId} />
    <input type="hidden" name="name" value={connectName} />
    <input type="hidden" name="condition" value="null" />
    <input type="hidden" name="priority" value={connectPriority} />
    <input type="hidden" name="data" value={JSON.stringify({ timing: 'on_complete', behavior: 'transition' })} />
  </form>

  <!-- Shared partials -->
  {#if partials.length > 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">
        {t('conversation.editor.partials', 'Shared Partials')}
      </h2>
      <div class="space-y-2">
        {#each partials as partial (partial.id)}
          <div class="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{partial.loc}</span>
              <button onclick={() => { partialContents[partial.loc] = partial.content ?? ''; editingPartial = partial.loc; }}
                class="text-xs text-indigo-500 hover:underline">
                {t('conversation.editor.partials.edit', 'Edit')}
              </button>
            </div>
            {#if editingPartial === partial.loc}
              <form method="POST" action="?/updatePrompt" use:enhance={() => { return async ({ update }) => { editingPartial = null; await update(); }; }} class="mt-2">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="loc" value={partial.loc} />
                <textarea name="content" bind:value={partialContents[partial.loc]} rows="5" class="{inputClass} font-mono text-xs"></textarea>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">
                    {t('conversation.editor.partials.save', 'Save')}
                  </button>
                  <button type="button" onclick={() => editingPartial = null} class="text-xs text-zinc-500">
                    {t('conversation.editor.partials.cancel', 'Cancel')}
                  </button>
                </div>
              </form>
            {:else if partial.content}
              <pre class="mt-1 max-h-16 overflow-y-auto text-xs text-zinc-500">{partial.content.slice(0, 200)}{(partial.content?.length ?? 0) > 200 ? '...' : ''}</pre>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
