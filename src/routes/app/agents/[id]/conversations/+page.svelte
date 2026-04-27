<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ConversationGraph from '$lib/components/ConversationGraph.svelte';
  import ElementSelector from '$lib/components/ElementSelector.svelte';
  import ConditionBuilder from '$lib/edge-conditions/ConditionBuilder.svelte';
  import { serialize } from '$lib/edge-conditions/serializer';
  import type { UiCondition } from '$lib/edge-conditions/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);

  let selectedGraphNodeId = $state<string | null>(null);
  let showGraph = $state(true);

  // Extract edges from outgoingEdges on system nodes for the graph
  const graphEdges = $derived.by(() => {
    const edges: Array<{ id: string; sourceId: string; targetId: string; label: string; data: Record<string, unknown> }> = [];
    for (const n of data.systemNodes) {
      const outgoing = (n as any).outgoingEdges as Array<{ id: string; label: string; target: { id: string; loc: string } }> | undefined;
      if (outgoing) {
        for (const e of outgoing) {
          edges.push({ id: e.id, sourceId: n.id, targetId: e.target.id, label: e.label, data: {} });
        }
      }
    }
    return edges;
  });

  let newConversationName = $state('');
  let newStageNames = $state<Record<string, string>>({});
  let editingPrompt = $state<string | null>(null);
  let editingSpec = $state<string | null>(null);
  let promptContents = $state<Record<string, string>>({});
  let specContents = $state<Record<string, string>>({});

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

  // ── Goal editor state ──
  let editingGoalsFor = $state<string | null>(null);  // conv loc
  let goalDescInput = $state('');
  let goalSignalsInput = $state('');

  function startEditGoals(convLoc: string, currentGoals: string[], currentSignals: string[]) {
    editingGoalsFor = convLoc;
    goalDescInput = currentGoals.join('\n');
    goalSignalsInput = currentSignals.join('\n');
  }

  // ── Edge editor state ──
  let addingEdgeFrom = $state<string | null>(null);  // node ID we're adding an edge FROM
  let edgeSelectorOpen = $state(false);
  let newEdgeLabel = $state('');
  let newEdgeTiming = $state('on_complete');
  let newEdgeBehavior = $state('transition');
  let newEdgeCondition = $state<UiCondition>(null);
  let newEdgePriority = $state(0);

  // Serialize the structured condition to JSONLogic for the hidden form
  // field. The server side validates again before persisting.
  const newEdgeConditionJson = $derived(JSON.stringify(serialize(newEdgeCondition)));

  // Build the list of selectable target nodes for the ElementSelector
  const selectableNodes = $derived(
    data.systemNodes
      .filter((n) => n.loc.startsWith('conversations:') && n.loc.split(':').length <= 3)
      .map((n) => ({
        id: n.id,
        name: n.name,
        loc: n.loc,
        type: n.loc.split(':').length === 2 ? 'conversation' : 'stage',
        description: n.description,
      })),
  );

  // Get outgoing edges for a given node
  function edgesFrom(nodeId: string): Array<{ id: string; label: string; targetLoc: string; data: Record<string, unknown> }> {
    const node = data.systemNodes.find((n) => n.id === nodeId);
    if (!node) return [];
    const outgoing = (node as any).outgoingEdges as Array<{ id: string; label: string; target: { id: string; loc: string; name: string }; data?: Record<string, unknown> }> | undefined;
    if (!outgoing) return [];
    return outgoing.map((e) => ({ id: e.id, label: e.label, targetLoc: e.target.loc, data: (e as any).data ?? {} }));
  }

  function applyEdgePreset(preset: string) {
    if (preset === 'next') {
      newEdgeTiming = 'on_complete'; newEdgeBehavior = 'transition'; newEdgeCondition = null;
    }
    if (preset === 'prerequisite') {
      newEdgeTiming = 'on_enter'; newEdgeBehavior = 'detour';
      // Seed a missing-field clause so the user can fill in the field.
      newEdgeCondition = {
        kind: 'group',
        combinator: 'and',
        children: [{ kind: 'clause', field: 'memory.', operator: 'missing' }],
      };
    }
    if (preset === 'escape') {
      newEdgeTiming = 'always'; newEdgeBehavior = 'transition'; newEdgeCondition = null;
    }
    if (preset === 'fallback') {
      newEdgeTiming = 'always'; newEdgeBehavior = 'transition'; newEdgeCondition = null;
    }
  }

  function startEditPrompt(stageLoc: string) {
    const promptRef = getPromptRef(stageLoc);
    if (!promptRef) return;
    const prompt = data.prompts.find((p) => p.loc === promptRef);
    promptContents[promptRef] = prompt?.content ?? '';
    editingPrompt = promptRef;
  }

  function startEditSpec(stageLoc: string) {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    const stageData = (stage?.data as Record<string, unknown>) ?? {};
    specContents[stageLoc] = JSON.stringify(stageData.extractionSpec ?? [], null, 2);
    editingSpec = stageLoc;
  }

  function getPromptRef(stageLoc: string): string | null {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    return ((stage?.data as Record<string, unknown>)?.promptRef as string) ?? null;
  }

  function getExtractionSpec(stageLoc: string): unknown[] {
    const stage = data.systemNodes.find((n) => n.loc === stageLoc);
    return ((stage?.data as Record<string, unknown>)?.extractionSpec as unknown[]) ?? [];
  }

  function getPromptContent(stageLoc: string): string {
    const ref = getPromptRef(stageLoc);
    if (!ref) return '';
    return data.prompts.find((p) => p.loc === ref)?.content ?? '';
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>Conversations · {agent.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Agents', href: '/app/agents' },
      { label: agent.name, href: `/app/agents/${agent.id}` },
      { label: 'Conversations' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Conversation Editor</h1>
    <p class="mt-1 text-sm text-zinc-500">Design conversation flows for {agent.name}</p>
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

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Graph view toggle -->
  <div class="flex items-center justify-between">
    <button
      type="button"
      onclick={() => { showGraph = !showGraph; }}
      class="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
    >
      {showGraph ? 'Hide graph' : 'Show graph'}
    </button>
  </div>

  {#if showGraph}
    <section class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <ConversationGraph
        nodes={data.systemNodes}
        edges={graphEdges}
        bind:selectedNodeId={selectedGraphNodeId}
      />
    </section>
  {/if}

  <!-- Conversations -->
  {#each data.conversations as conv}
    <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      <!-- Conversation header -->
      <div class="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800" style="background: rgba(33, 158, 188, 0.08);">
        <div>
          <h2 class="font-semibold text-zinc-900 dark:text-white">{conv.node.description || conv.node.name}</h2>
          <p class="font-mono text-xs text-zinc-400">{conv.node.loc}</p>
          {#if conv.data.isSetup}
            <span class="mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium" style="background: #ffb703; color: #023047;">Setup</span>
          {/if}
        </div>
        <div class="text-xs text-zinc-500">{conv.stages.length} stage{conv.stages.length !== 1 ? 's' : ''}</div>
      </div>

      <!-- Goals -->
      {#if !conv.data.isSetup && !conv.data.isFallback}
        {@const goals = Array.isArray(conv.data.goalDescriptions) ? conv.data.goalDescriptions : []}
        {@const signals = Array.isArray(conv.data.goalSignals) ? conv.data.goalSignals : []}
        <div class="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {#if editingGoalsFor === conv.node.loc}
            <!-- Goal editor -->
            <form method="POST" action="?/updateGoals" use:enhance={() => { return async ({ update }) => { editingGoalsFor = null; await update(); }; }}>
              <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
              <input type="hidden" name="convLoc" value={conv.node.loc} />
              <div class="space-y-2">
                <div>
                  <label class="text-[10px] font-medium text-zinc-500">Goal descriptions (one per line)</label>
                  <textarea
                    bind:value={goalDescInput}
                    rows="3"
                    placeholder="Help the user find a mentor&#10;Answer questions about mentorship"
                    class="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-600"
                  ></textarea>
                  <p class="text-[10px] text-zinc-400">Describe when this conversation is the right fit. Multiple phrasings improve routing.</p>
                </div>
                <div>
                  <label class="text-[10px] font-medium text-zinc-500">Goal signals (one per line)</label>
                  <textarea
                    bind:value={goalSignalsInput}
                    rows="3"
                    placeholder="I need a mentor&#10;Find someone to help me&#10;Is Nina back in town?"
                    class="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-600"
                  ></textarea>
                  <p class="text-[10px] text-zinc-400">Example user statements that should route here. This list grows from real usage.</p>
                </div>
                <input type="hidden" name="goalDescriptions" value={JSON.stringify(goalDescInput.split('\n').map(s => s.trim()).filter(Boolean))} />
                <input type="hidden" name="goalSignals" value={JSON.stringify(goalSignalsInput.split('\n').map(s => s.trim()).filter(Boolean))} />
                <div class="flex gap-2">
                  <button type="submit" class="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600">Save Goals</button>
                  <button type="button" onclick={() => { editingGoalsFor = null; }} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </div>
            </form>
          {:else}
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-zinc-500">Goals & Signals</span>
              <button type="button" onclick={() => startEditGoals(conv.node.loc, goals, signals)}
                class="text-[10px] text-indigo-500 hover:underline">Edit</button>
            </div>
            {#if goals.length || signals.length}
              {#if goals.length}
                <ul class="mt-1 space-y-0.5">
                  {#each goals as goal}
                    <li class="text-xs text-zinc-600 dark:text-zinc-400">- {goal}</li>
                  {/each}
                </ul>
              {/if}
              {#if signals.length}
                <p class="mt-1 text-xs text-zinc-400">Signals: {signals.join(', ')}</p>
              {/if}
            {:else}
              <p class="mt-1 text-xs text-zinc-400">No goals defined. <button type="button" onclick={() => startEditGoals(conv.node.loc, [], [])} class="text-indigo-500 hover:underline">Add goals</button> to enable routing.</p>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Stages -->
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        {#each conv.stages as stage, idx}
          {@const stageLoc = stage.loc}
          {@const stageEdges = edgesFrom(stage.id)}
          {@const spec = getExtractionSpec(stageLoc)}
          {@const prompt = getPromptContent(stageLoc)}
          <div class="px-5 py-4">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <span class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background: #219ebc;">{idx + 1}</span>
                  <h3 class="text-sm font-medium text-zinc-900 dark:text-white">{stage.description || stage.name}</h3>
                </div>
                <p class="mt-0.5 pl-7 font-mono text-xs text-zinc-400">{stageLoc}</p>
              </div>
              <div class="flex gap-2">
                <button onclick={() => startEditPrompt(stageLoc)} class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
                  Edit Prompt
                </button>
                <button onclick={() => startEditSpec(stageLoc)} class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
                  Edit Extraction
                </button>
              </div>
            </div>

            <!-- Prompt preview -->
            {#if prompt}
              <div class="mt-2 pl-7">
                <p class="text-xs font-medium text-zinc-500 mb-1">Prompt:</p>
                <pre class="max-h-24 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">{prompt.slice(0, 300)}{prompt.length > 300 ? '...' : ''}</pre>
              </div>
            {/if}

            <!-- Extraction spec preview -->
            {#if spec.length > 0}
              <div class="mt-2 pl-7">
                <p class="text-xs font-medium text-zinc-500 mb-1">Extracts:</p>
                <div class="flex flex-wrap gap-1">
                  {#each spec as field}
                    <span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      {(field as any).field ?? '?'}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Prompt editor (inline) -->
            {#if editingPrompt === getPromptRef(stageLoc)}
              {@const pRef = getPromptRef(stageLoc)!}
              <form method="POST" action="?/updatePrompt" use:enhance={() => { return async ({ update }) => { editingPrompt = null; await update(); }; }} class="mt-3 pl-7">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="loc" value={pRef} />
                <textarea name="content" bind:value={promptContents[pRef]} rows="10" class="{inputClass} font-mono text-xs"></textarea>
                <p class="mt-1 text-[10px] text-zinc-400">Supports Mustache: {'{{var}}'}, {'{{node.field}}'}, {'{{> partial}}'}, {'{{#flag}}...{{/flag}}'}</p>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save Prompt</button>
                  <button type="button" onclick={() => editingPrompt = null} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </form>
            {/if}

            <!-- Outgoing edges -->
            {#if stageEdges.length > 0 || addingEdgeFrom === stage.id}
              <div class="mt-2 pl-7">
                <span class="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Edges</span>
                {#each stageEdges as edge}
                  <div class="mt-1 flex items-center gap-2 text-xs">
                    <span class="text-zinc-500">&rarr;</span>
                    <span class="text-zinc-700 dark:text-zinc-300">{edge.targetLoc}</span>
                    <span class="text-zinc-400">({edge.label})</span>
                    {#if edge.data.timing}<span class="rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800">{edge.data.timing}</span>{/if}
                    {#if edge.data.behavior === 'detour'}<span class="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">detour</span>{/if}
                    <form method="POST" action="?/deleteEdge" use:enhance class="inline">
                      <input type="hidden" name="edgeId" value={edge.id} />
                      <button type="submit" class="text-red-400 hover:text-red-300">&times;</button>
                    </form>
                  </div>
                {/each}
              </div>
            {/if}

            {#if addingEdgeFrom === stage.id}
              <!-- Edge creation form -->
              <div class="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 pl-7 dark:border-zinc-800 dark:bg-zinc-950">
                <div class="mb-2 flex gap-1">
                  <button type="button" onclick={() => applyEdgePreset('next')} class="rounded bg-zinc-200 px-2 py-0.5 text-[10px] dark:bg-zinc-700">Next</button>
                  <button type="button" onclick={() => applyEdgePreset('prerequisite')} class="rounded bg-zinc-200 px-2 py-0.5 text-[10px] dark:bg-zinc-700">Prerequisite</button>
                  <button type="button" onclick={() => applyEdgePreset('escape')} class="rounded bg-zinc-200 px-2 py-0.5 text-[10px] dark:bg-zinc-700">Escape</button>
                  <button type="button" onclick={() => applyEdgePreset('fallback')} class="rounded bg-zinc-200 px-2 py-0.5 text-[10px] dark:bg-zinc-700">Fallback</button>
                </div>
                <form method="POST" action="?/addEdge" use:enhance={() => { return async ({ update }) => { addingEdgeFrom = null; await update(); }; }}>
                  <input type="hidden" name="sourceNodeId" value={stage.id} />
                  <div class="space-y-2">
                    <div>
                      <label class="text-[10px] text-zinc-500">Target</label>
                      <button type="button" onclick={() => { edgeSelectorOpen = true; }}
                        class="block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-left text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                        {newEdgeLabel ? `→ ${newEdgeLabel}` : 'Select target...'}
                      </button>
                      <input type="hidden" name="targetNodeId" id="edgeTargetNodeId-{stage.id}" value="" />
                    </div>
                    <div class="flex gap-2">
                      <div class="flex-1">
                        <label class="text-[10px] text-zinc-500">Label</label>
                        <input type="text" name="label" bind:value={newEdgeLabel} placeholder="Edge label" class="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                      </div>
                      <div>
                        <label class="text-[10px] text-zinc-500">Timing</label>
                        <select bind:value={newEdgeTiming} class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                          <option value="on_complete">on_complete</option>
                          <option value="on_enter">on_enter</option>
                          <option value="always">always</option>
                        </select>
                      </div>
                      <div>
                        <label class="text-[10px] text-zinc-500">Behavior</label>
                        <select bind:value={newEdgeBehavior} class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                          <option value="transition">transition</option>
                          <option value="detour">detour</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <ConditionBuilder bind:value={newEdgeCondition} />
                    </div>
                    <div class="flex gap-2">
                      <div>
                        <label class="text-[10px] text-zinc-500">Priority</label>
                        <input type="number" bind:value={newEdgePriority} step="1"
                          class="w-20 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
                        <span class="ml-1 text-[10px] text-zinc-500">lower fires first</span>
                      </div>
                    </div>
                    <input type="hidden" name="condition" value={newEdgeConditionJson} />
                    <input type="hidden" name="priority" value={newEdgePriority} />
                    <input type="hidden" name="data" value={JSON.stringify({
                      timing: newEdgeTiming,
                      behavior: newEdgeBehavior,
                    })} />
                    <div class="flex gap-2">
                      <button type="submit" class="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600">Add Edge</button>
                      <button type="button" onclick={() => { addingEdgeFrom = null; }} class="text-xs text-zinc-500">Cancel</button>
                    </div>
                  </div>
                </form>
              </div>
            {:else}
              <button type="button" onclick={() => { addingEdgeFrom = stage.id; newEdgeLabel = ''; newEdgePriority = 0; applyEdgePreset('next'); }}
                class="mt-1 pl-7 text-[10px] text-indigo-500 hover:underline">
                + Add edge
              </button>
            {/if}

            {#if editingSpec === stageLoc}
              <form method="POST" action="?/updateExtractionSpec" use:enhance={() => { return async ({ update }) => { editingSpec = null; await update(); }; }} class="mt-3 pl-7">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="stageLoc" value={stageLoc} />
                <textarea name="extractionSpec" bind:value={specContents[stageLoc]} rows="8" class="{inputClass} font-mono text-xs"></textarea>
                <p class="mt-1 text-[10px] text-zinc-400">JSON array: [{'{ "field": "memory.name", "description": "User name", "shape": "string" }'}]</p>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save Extraction</button>
                  <button type="button" onclick={() => editingSpec = null} class="text-xs text-zinc-500">Cancel</button>
                </div>
              </form>
            {/if}
          </div>
        {/each}

        <!-- Add stage -->
        <div class="px-5 py-3">
          <form method="POST" action="?/addStage" use:enhance class="flex items-end gap-2">
            <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
            <input type="hidden" name="conversationLoc" value={conv.node.loc} />
            <div class="flex-1">
              <input type="text" name="stageName" placeholder="New stage name..."
                bind:value={newStageNames[conv.node.loc]}
                class="w-full rounded border border-dashed border-zinc-300 bg-transparent px-3 py-1.5 text-sm placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:placeholder-zinc-600" />
            </div>
            <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              + Add Stage
            </button>
          </form>
        </div>
      </div>
    </div>
  {/each}

  <!-- Add conversation -->
  <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
    <form method="POST" action="?/addConversation" use:enhance class="flex items-end gap-3">
      <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
      <div class="flex-1">
        <label for="newConv" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">New Conversation</label>
        <input id="newConv" type="text" name="name" placeholder="e.g. Find Mentor, Business Review, Write Profile"
          bind:value={newConversationName}
          class={inputClass} />
      </div>
      <button type="submit" disabled={!newConversationName.trim()}
        class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style="background: #219ebc;">
        + Add Conversation
      </button>
    </form>
  </div>

  <!-- Shared partials -->
  {#if data.prompts.filter(p => p.loc.startsWith('prompts:partials:')).length > 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Shared Partials</h2>
      <div class="space-y-2">
        {#each data.prompts.filter(p => p.loc.startsWith('prompts:partials:')) as partial}
          <div class="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{partial.loc}</span>
              <button onclick={() => { promptContents[partial.loc] = partial.content ?? ''; editingPrompt = partial.loc; }}
                class="text-xs text-indigo-500 hover:underline">Edit</button>
            </div>
            {#if editingPrompt === partial.loc}
              <form method="POST" action="?/updatePrompt" use:enhance={() => { return async ({ update }) => { editingPrompt = null; await update(); }; }} class="mt-2">
                <input type="hidden" name="systemMemoryId" value={data.systemMemoryId} />
                <input type="hidden" name="loc" value={partial.loc} />
                <textarea name="content" bind:value={promptContents[partial.loc]} rows="5" class="{inputClass} font-mono text-xs"></textarea>
                <div class="mt-2 flex gap-2">
                  <button type="submit" class="rounded px-3 py-1.5 text-xs font-medium text-white" style="background: #fb8500;">Save</button>
                  <button type="button" onclick={() => editingPrompt = null} class="text-xs text-zinc-500">Cancel</button>
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

<!-- Element selector modal for edge targets -->
<ElementSelector
  elements={selectableNodes}
  placeholder="Search conversations and stages..."
  bind:open={edgeSelectorOpen}
  onselect={(el) => {
    // Set the target node ID on the hidden input in the active edge form
    if (addingEdgeFrom) {
      const input = document.getElementById(`edgeTargetNodeId-${addingEdgeFrom}`);
      if (input) (input as HTMLInputElement).value = el.id;
      newEdgeLabel = newEdgeLabel || `→ ${el.name}`;
    }
  }}
/>
