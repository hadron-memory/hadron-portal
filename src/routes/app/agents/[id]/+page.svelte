<script lang="ts">
  import { enhance } from '$app/forms';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import NodeTable, { type NodeRow } from '$lib/components/NodeTable.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import { installStrings } from '$lib/i18n/install-strings';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import type { MemoryNode } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);
  const orgSystemMemories = $derived((data as any).orgSystemMemories ?? []);
  const writableMemoryIds = $derived((agent.memoryItems ?? []).filter((m) => m.role === 'read-write').map((m) => m.memory.id));

  // Agents with a system memory get the Chatbot Control tab. The chatbot
  // sub-tab system opens per-conversation or per-partial sub-tabs when the
  // user clicks a row, so they can drill down without leaving the page.
  const hasSystemMemory = $derived(!!agent.systemMemoryId);

  // #352 tab reorg: Profile (agent info) is the landing tab; Memories and
  // AI Providers were split out of the old Settings tab; the old "Memory"
  // node browser is now "Nodes"; Settings keeps the danger zone.
  type TabId = 'profile' | 'memories' | 'nodes' | 'chatbot' | 'ai' | 'settings';
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
    { id: 'memories', label: 'Memories' },
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

  let isEditing = $state(false);
  let confirmDelete = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function urnSlug(urn: string): string {
    return urn.includes(':') ? urn.split(':').slice(1).join(':') : urn;
  }

  // Ordered most→least restrictive. Spec 034 added GROUP to memory visibility;
  // spec 035: agent.visibility is one of PERSONAL/ORGANIZATION/PUBLIC (its own
  // AgentVisibility enum). PERSONAL (agent, creator-only) and a null memory
  // visibility (owner-only) are both the most restrictive, rank 0.
  const visibilityRank: Record<string, number> = { PERSONAL: 0, GROUP: 1, ORGANIZATION: 2, PUBLIC: 3 };
  const visibilityLabel: Record<string, string> = { PERSONAL: 'Personal', GROUP: 'Group', ORGANIZATION: 'Organization', PUBLIC: 'Public' };
  // Spec 034: a memory's visibility is now nullable (null = owner-only
  // personal/private — the most restrictive) and may be GROUP. Route every
  // memory-visibility read through these so null/GROUP rank and label safely.
  const memVisRank = (v: string | null) => (v == null ? 0 : (visibilityRank[v] ?? 0));
  const memVisLabel = (v: string | null) => (v == null ? 'Only you' : (visibilityLabel[v] ?? v));

  // Check if any attached memory is more restrictive than the agent
  const restrictiveMemories = $derived(
    (agent.memoryItems ?? []).filter((item) =>
      memVisRank(item.memory.visibility) < visibilityRank[agent.visibility]
    )
  );

  // Track selected add-memory id for warning
  let selectedAddMemoryId = $state('');
  let selectMemoryOpen = $state(false);

  const memoryIdsInAgent = $derived(new Set((agent.memoryItems ?? []).map((item) => item.memory.id)));
  const allMemories = $derived.by(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; urn: string; name: string; visibility?: string | null; class?: string; orgName?: string }> = [];
    for (const o of (data as any).allOrgs ?? [org]) {
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
        result.push({ ...m, orgName: org.name });
      }
    }
    return result;
  });
  const availableMemories = $derived(allMemories.filter((m) => !memoryIdsInAgent.has(m.id) && m.class !== 'system'));

  const selectedAddMemory = $derived(
    allMemories.find((m) => m.id === selectedAddMemoryId)
  );
  const addMemoryWarning = $derived.by(() => {
    if (!selectedAddMemory || !('visibility' in selectedAddMemory)) return '';
    const memVis = (selectedAddMemory as { visibility?: string | null }).visibility ?? null;
    if (memVisRank(memVis) >= visibilityRank[agent.visibility]) return '';
    return `This memory is ${memVisLabel(memVis)} but the agent is ${visibilityLabel[agent.visibility]}. The effective access will be ${memVisLabel(memVis)}.`;
  });
</script>

<svelte:head><title>{agent.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Agents', href: '/app/agents' },
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
      <p class="mt-1 text-xs text-zinc-400">Organization: {org.name}</p>
    </div>
    <!-- 009-install-agent-flow T013: Install action surfaces here as the
         primary call-to-action for the Agent detail page. Soft-deleted
         Agents don't reach this page (the load redirect would 404 first),
         so no client-side gate needed. -->
    <a
      href="/app/orgs/{org.id}/agents/install/{agent.id}"
      class="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white"
      style="background: #fb8500;"
    >
      {installStrings.buttonLabel()}
    </a>
  </div>

  {#if restrictiveMemories.length > 0}
    <div class="rounded-lg border border-amber-700 bg-amber-950 px-4 py-3 text-sm text-amber-300">
      Visibility mismatch: this agent is <strong>{visibilityLabel[agent.visibility]}</strong> but
      {restrictiveMemories.length === 1 ? 'memory' : 'memories'}
      {restrictiveMemories.map((m) => m.memory.name).join(', ')}
      {restrictiveMemories.length === 1 ? 'is' : 'are'} more restrictive.
      Effective access will be limited to the most restrictive level.
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
  </div>

  <!-- Action feedback lives at page level so it stays visible no matter which
       tab's form produced it (#352 split the agent / memory / delete forms
       across the Profile, Memories, and Settings tabs). -->
  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Changes saved.</div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- PROFILE TAB — info of this agent (#352)                             -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'profile'}
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
          {#if agent.systemPrompt}
            <div class="px-5 py-3">
              <span class="text-sm text-zinc-500">System Prompt</span>
              <p class="mt-1 text-sm text-zinc-900 dark:text-white whitespace-pre-wrap">{agent.systemPrompt}</p>
            </div>
          {/if}
          {#if agent.systemMemoryId}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">System Memory</span>
              <a href="/app/agents/{agent.id}/conversations" class="text-sm font-medium text-indigo-500 hover:underline dark:text-indigo-400">Conversation Editor →</a>
            </div>
          {/if}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Organization</span>
            <span class="text-sm text-zinc-900 dark:text-white">{org.name}</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Created</span>
            <span class="text-sm text-zinc-900 dark:text-white">{new Date(agent.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </section>

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
                      <a href="/app/agents/{imp.importedAgentId}" class="text-indigo-500 hover:underline dark:text-indigo-400">{imp.importedAgent.name}</a>
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
        <span class="ml-1 text-sm font-normal text-zinc-500">({(agent.memoryItems ?? []).length})</span>
      </h2>
      {#if (agent.memoryItems ?? []).length > 0}
        <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
          {#each agent.memoryItems ?? [] as item (item.id)}
            <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
              <span class="w-3.5 shrink-0">
                {#if item.role !== 'read-write'}
                  <span title="Read only"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
                {/if}
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium">
                  <a href="/app/memories/{item.memory.id}" class="text-indigo-600 hover:underline dark:text-indigo-300">{item.memory.name}</a>
                  {#if memVisRank(item.memory.visibility) < visibilityRank[agent.visibility]}
                    <span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300" title="More restrictive than agent">{memVisLabel(item.memory.visibility)}</span>
                  {/if}
                </p>
                <Urn value={item.memory.urn} type="memory" size={10} />
              </div>
              <form method="POST" action="?/updateMemoryRole" use:enhance class="flex items-center">
                <input type="hidden" name="memoryId" value={item.memory.id} />
                <select name="role" value={item.role} onchange={(e) => e.currentTarget.form?.requestSubmit()} class="rounded-full border px-2.5 py-0.5 text-xs font-medium {item.role === 'read-write' ? '[border-color:rgb(134,239,172)] [background-color:rgb(240,253,244)] [color:rgb(21,128,61)] dark:[border-color:rgb(22,101,52)] dark:[background-color:rgb(20,83,45)] dark:[color:rgb(134,239,172)]' : '[border-color:rgb(252,211,77)] [background-color:rgb(255,251,235)] [color:rgb(180,83,9)] dark:[border-color:rgb(120,53,15)] dark:[background-color:rgb(69,26,3)] dark:[color:rgb(252,211,77)]'}">
                  <option value="read">read</option>
                  <option value="read-write">read-write</option>
                </select>
              </form>
              <form method="POST" action="?/removeMemory" use:enhance>
                <input type="hidden" name="memoryId" value={item.memory.id} />
                <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
              </form>
            </div>
          {/each}
        </div>
      {:else}
        <p class="mb-4 text-sm text-zinc-500">No memories in this agent.</p>
      {/if}

      {#if availableMemories.length > 0}
        <form method="POST" action="?/addMemory" use:enhance={() => {
          return async ({ update }) => {
            await update();
            selectedAddMemoryId = '';
          };
        }} class="space-y-2">
          <div class="flex items-end gap-3">
          <div class="flex-1 max-w-md">
            <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Add memory</label>
            <div class="flex gap-2">
              <button
                type="button"
                onclick={() => selectMemoryOpen = true}
                class="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
              >
                {#if selectedAddMemoryId}
                  {selectedAddMemory?.name ?? 'Select a memory'}
                {:else}
                  Select a memory
                {/if}
              </button>
              <input type="hidden" name="memoryId" value={selectedAddMemoryId} />
            </div>
          </div>
          <div>
            <label for="memRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
            <select id="memRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="read">Read</option>
              <option value="read-write">Read/Write</option>
            </select>
          </div>
          <button type="submit" disabled={!selectedAddMemoryId} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50">Add</button>
          </div>
          {#if addMemoryWarning}
            <p class="text-xs text-amber-600 dark:text-amber-400">{addMemoryWarning}</p>
          {/if}
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
      selectedAddMemoryId = memory.id;
    }}
  />

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- NODES TAB — browse the agent's memory nodes (was "Memory") (#352)   -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'nodes'}
    <MemoryBrowser nodes={data.agentNodes ?? []} multiMemory={(agent.memoryItems ?? []).length > 1} {writableMemoryIds} />
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
        members={org.members ?? []}
        currentUserId={data.currentUserId}
        configsError={data.configsError}
      />
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETTINGS TAB — the rest (#352)                                      -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'settings'}
    <div class="space-y-8">
      <!-- Agent settings (editable). #352 follow-up: the editable agent form
           lives here; the Profile tab shows the same info read-only. -->
      <section class="max-w-lg">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">Agent</h2>
          {#if !isEditing}
            <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
          {/if}
        </div>

        {#if isEditing}
          <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
            class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
            <div>
              <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input id="editName" name="name" type="text" required value={agent.name} class={inputClass} />
            </div>
            <div>
              <label for="editUrn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <div class="flex items-stretch">
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
                <input id="editUrn" name="urnSlug" type="text" required value={urnSlug(agent.urn)}
                  class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
              </div>
            </div>
            <div>
              <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <textarea id="editDescription" name="description" rows="3" placeholder="What this agent is for" class={inputClass}>{agent.description ?? ''}</textarea>
            </div>
            <div>
              <label for="editSystemPrompt" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
              <textarea id="editSystemPrompt" name="systemPrompt" rows="4" placeholder="Instructions for the LLM when using this agent" class={inputClass}>{agent.systemPrompt ?? ''}</textarea>
              <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each session.</p>
            </div>
            <div>
              <label for="editVisibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
              <select id="editVisibility" name="visibility" value={agent.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="PERSONAL">Personal</option>
                <option value="ORGANIZATION">Organization</option>
                <option value="PUBLIC">Public</option>
              </select>
            </div>
            <div>
              <label for="editSystemMemoryId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Memory <span class="text-zinc-500">(for chatbot conversations)</span></label>
              <select id="editSystemMemoryId" name="systemMemoryId" value={agent.systemMemoryId ?? ''} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="">— None —</option>
                {#each orgSystemMemories as sm}
                  <option value={sm.id}>{sm.name} ({sm.urn})</option>
                {/each}
              </select>
              <p class="mt-1 text-xs text-zinc-400">Memory containing conversation designs, stages, and prompt templates.</p>
            </div>
            <div class="flex gap-3">
              <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Save</button>
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
            {#if agent.systemPrompt}
              <div class="px-5 py-3">
                <span class="text-sm text-zinc-500">System Prompt</span>
                <p class="mt-1 text-sm text-zinc-900 dark:text-white whitespace-pre-wrap">{agent.systemPrompt}</p>
              </div>
            {/if}
            {#if agent.systemMemoryId}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">System Memory</span>
                <a href="/app/agents/{agent.id}/conversations" class="text-sm font-medium text-indigo-500 hover:underline dark:text-indigo-400">Conversation Editor →</a>
              </div>
            {/if}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Organization</span>
              <span class="text-sm text-zinc-900 dark:text-white">{org.name}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Created</span>
              <span class="text-sm text-zinc-900 dark:text-white">{new Date(agent.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
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
          <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
            <span class="text-sm text-red-500">Delete "{agent.name}"? This cannot be undone.</span>
            <button type="submit" class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">Yes, delete</button>
            <button type="button" onclick={() => confirmDelete = false} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
          </form>
        {/if}
      </section>
    </div>
  {/if}
</div>
