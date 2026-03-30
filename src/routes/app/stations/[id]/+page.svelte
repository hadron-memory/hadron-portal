<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import JSZip from 'jszip';
  import CopyUrn from '$lib/components/CopyUrn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import TopicGraph from '$lib/components/TopicGraph.svelte';
  import { chatContext } from '$lib/stores/chat-context';
  import { AI_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import { buildGraphViewData } from '$lib/graph-utils';
  import type { AIProvider, StationAIConfig } from '$lib/types';
  import Chat from '$lib/components/Chat.svelte';
  import { onDestroy } from 'svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const station = $derived(data.station);

  // ── Tab state ──────────────────────────────────────────────────────────
  type TabId = 'chat' | 'memory' | 'nodes' | 'setup' | 'settings';
  let activeTab = $state<TabId>('chat');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'memory', label: 'Memory' },
    { id: 'nodes', label: 'Nodes' },
    { id: 'setup', label: 'Setup' },
    { id: 'settings', label: 'Settings' },
  ];

  // ── Station context for chatbot ────────────────────────────────────────
  $effect(() => {
    const agents = (station.agentSubscriptions ?? []).map((s) => s.agent.name);
    const tools = station.agentTools ?? [];
    chatContext.set({
      pageContext: [
        `The user is viewing station "${station.name}" (type: ${station.stationType}).`,
        station.description ? `Description: ${station.description}` : '',
        agents.length ? `Subscribed agents: ${agents.join(', ')}.` : 'No agents subscribed yet.',
        tools.length ? `Selected AI tools: ${tools.join(', ')}.` : 'No AI tools selected yet.',
        `Station URN: ${station.urn}`,
        `Help this user configure Hadron for their station.`,
      ].filter(Boolean).join('\n'),
      stationId: station.id,
      aiProvider: station.aiProvider,
      aiModel: station.aiModel,
      hasAiApiKey: station.hasAiApiKey,
    });
  });

  onDestroy(() => {
    chatContext.set({ pageContext: '' });
  });

  // ── Agent/memory computed state ────────────────────────────────────────
  const subscribedAgentIds = $derived(new Set((station.agentSubscriptions ?? []).map((s) => s.agent.id)));
  const availableAgents = $derived(
    (data.orgs ?? []).flatMap((o) => o.agents ?? []).filter((a) => !subscribedAgentIds.has(a.id))
  );

  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CHATBOT: '💬', CLOUD: '☁️', IOT: '📡', AGENT: '🤖' };
  let isEditing = $state(false);

  interface EffectiveMemory { id: string; urn: string; name: string; access: 'read' | 'read-write'; agentName: string }
  const effectiveMemories = $derived.by(() => {
    const map = new Map<string, EffectiveMemory>();
    for (const sub of station.agentSubscriptions ?? []) {
      for (const item of sub.agent.memoryItems ?? []) {
        const effective = sub.subscriptionType === 'READ_WRITE' && item.role === 'read-write'
          ? 'read-write' as const : 'read' as const;
        const existing = map.get(item.memory.id);
        if (!existing || (effective === 'read-write' && existing.access === 'read')) {
          map.set(item.memory.id, { id: item.memory.id, urn: item.memory.urn, name: item.memory.name, access: effective, agentName: sub.agent.name });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const SYSTEM_MEMORY_URNS = ['hadronmemory.com:core'];
  const userMemories = $derived(effectiveMemories.filter((m) => !SYSTEM_MEMORY_URNS.includes(m.urn)));
  const hasWritableMemory = $derived(effectiveMemories.some((m) => m.access === 'read-write'));

  // ── Graph view data from station nodes ─────────────────────────────────
  const graphViewData = $derived(buildGraphViewData(data.stationNodes ?? []));

  // ── Nodes tab: flat listing ────────────────────────────────────────────
  let nodeSearch = $state('');
  const filteredNodes = $derived(
    (data.stationNodes ?? []).filter((n) => {
      if (!nodeSearch) return true;
      const q = nodeSearch.toLowerCase();
      return n.name.toLowerCase().includes(q) || n.loc.toLowerCase().includes(q) || (n.description ?? '').toLowerCase().includes(q);
    })
  );

  // Color palette for memories in nodes list
  const memoryColors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f97583', '#56d4dd'];
  const memoryColorMap = $derived.by(() => {
    const map: Record<string, string> = {};
    const urns = [...new Set((data.stationNodes ?? []).map((n) => n.memory?.urn ?? ''))];
    urns.forEach((u, i) => { map[u] = memoryColors[i % memoryColors.length]; });
    return map;
  });

  // ── AI chat config ─────────────────────────────────────────────────────
  let aiProvider = $state<AIProvider>((station.aiProvider as AIProvider) ?? 'openai');
  let aiApiKey = $state('');
  let aiModel = $state(station.aiModel ?? DEFAULT_MODELS['openai']);
  let chatActive = $state(false);
  let chatKey = $state(0);
  let aiConfigOpen = $state(false);

  let aiConfig = $derived<StationAIConfig>({ provider: aiProvider, apiKey: aiApiKey, model: aiModel });

  function onProviderChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    aiProvider = val as AIProvider;
    aiModel = DEFAULT_MODELS[aiProvider];
  }

  async function saveAndStartChat() {
    if (!aiApiKey.trim()) return;
    try {
      const res = await fetch('/api/stations/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: station.id, provider: aiProvider, apiKey: aiApiKey, model: aiModel }),
      });
      if (!res.ok) return;
    } catch { return; }
    chatKey++;
    chatActive = true;
    aiConfigOpen = false;
  }

  function disconnectChat() { chatActive = false; }

  // ── Setup tab state ────────────────────────────────────────────────────
  const AGENT_TOOL_OPTIONS = [
    { value: 'CLAUDE_CODE', label: 'Claude Code' },
    { value: 'CURSOR', label: 'Cursor' },
    { value: 'WINDSURF', label: 'Windsurf' },
    { value: 'CLAUDE_DESKTOP', label: 'Claude Desktop' },
    { value: 'CODEX', label: 'Codex CLI' },
    { value: 'CLINE', label: 'Cline' },
  ];

  let editingSubId = $state<string | null>(null);
  let downloading = $state(false);
  let agentToolsForm = $state<HTMLFormElement>();
  let selectedTools = $derived(new Set(station.agentTools ?? []));
  let withClientApp = $state(false);

  function toggleTool(value: string) {
    if (selectedTools.has(value)) { selectedTools.delete(value); } else { selectedTools.add(value); }
    selectedTools = new Set(selectedTools);
    setTimeout(() => agentToolsForm?.requestSubmit(), 0);
  }

  // ── Zip generation ─────────────────────────────────────────────────────
  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
  const clientAppUrl = 'http://localhost:3200';
  const mcpBaseUrl = $derived(withClientApp ? clientAppUrl : serverUrl);
  const mcpUrl = $derived(mcpBaseUrl.includes('localhost') ? mcpBaseUrl + '/mcp' : mcpBaseUrl.replace(/\/$/, '') + '/mcp');

  function directMcpConfig(apiKey: string) {
    return { mcpServers: { hadron: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${apiKey}` } } } };
  }
  function clientAppMcpConfig(apiKey: string) {
    return { mcpServers: { hadron: { url: `${clientAppUrl}/mcp`, headers: { Authorization: `Bearer ${apiKey}` } } } };
  }
  function claudeCodeHooksConfig() {
    return { hooks: {
      SessionStart: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/session-start`, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/before-prompt`, timeout: 5 }] }],
      PostToolUse: [{ matcher: 'mcp__hadron', hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/after-tool`, timeout: 5 }] }],
      PostCompact: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/post-compact`, timeout: 5 }] }],
    }};
  }

  const INSTRUCTIONS_MD = `# Hadron Graph — AI Instructions

This project is connected to Hadron, a knowledge graph that stores context
across sessions — what's been learned, decided, and built.

You have access to the following MCP tools:

- **h-start-session** / **h-end-session** — Track work sessions
- **h-find-node** — Search nodes by name, tags, or description
- **h-read-node** — Read a node's full content and edges
- **h-read-next-node** — Navigate to the next sibling node, ordered by seq
- **h-create-node** — Create or update a node (full upsert by loc)
- **h-update-node** — Partially update a node (only provided fields change)
- **h-move-node** — Rename or move a node to a new loc
- **h-run-action** — Load an action node and resolve dependencies
- **h-validate** — Validate graph structure (orphan nodes, broken edges)
- **h-sync-graph** — Trigger a sync from the git source

Start each session with h-start-session. Use h-find-node and h-read-node
to learn context before making changes. When you learn something new or
notice outdated information, update the graph with h-create-node.
`;

  async function generateAndDownloadZip(apiKey: string) {
    const zip = new JSZip();
    const tools = station.agentTools ?? [];
    if (withClientApp) { generateClientAppZip(zip, tools, apiKey); } else { generateDirectZip(zip, tools, apiKey); }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `hadron-setup-${station.name}.zip`; a.click();
    URL.revokeObjectURL(url);
  }

  function generateDirectZip(zip: JSZip, tools: string[], apiKey: string) {
    const config = directMcpConfig(apiKey);
    const configJson = JSON.stringify(config, null, 2);
    if (tools.includes('CLAUDE_CODE'))    zip.file('.mcp.json', configJson);
    if (tools.includes('CURSOR'))         zip.file('.cursor/mcp.json', configJson);
    if (tools.includes('WINDSURF'))       zip.file('.windsurf/mcp.json', configJson);
    if (tools.includes('CLAUDE_DESKTOP')) zip.file('claude_desktop_config.json', configJson);
    if (tools.includes('CODEX'))          zip.file('.codex/mcp.json', configJson);
    if (tools.includes('CLINE'))          zip.file('.cline/mcp.json', configJson);
    zip.file('.hadron/INSTRUCTIONS.md', INSTRUCTIONS_MD);
    zip.file('README.txt', ['Hadron Setup', '===========', '', 'Extract in your project root.', '', 'Your API key is embedded. Keep these files private.'].join('\n'));
  }

  function generateClientAppZip(zip: JSZip, tools: string[], apiKey: string) {
    const config = clientAppMcpConfig(apiKey);
    const configJson = JSON.stringify(config, null, 2);
    if (tools.includes('CLAUDE_CODE'))    zip.file('.claude/mcp.json', configJson);
    if (tools.includes('CURSOR'))         zip.file('.cursor/mcp.json', configJson);
    if (tools.includes('WINDSURF'))       zip.file('.windsurf/mcp.json', configJson);
    if (tools.includes('CLAUDE_DESKTOP')) zip.file('claude_desktop_config.json', configJson);
    if (tools.includes('CODEX'))          zip.file('.codex/mcp.json', configJson);
    if (tools.includes('CLINE'))          zip.file('.cline/mcp.json', configJson);
    if (tools.includes('CLAUDE_CODE')) zip.file('.claude/settings.json', JSON.stringify(claudeCodeHooksConfig(), null, 2));
    zip.file('.hadron/config.json', JSON.stringify({ stationKey: apiKey, defaultLevel: 'guided' }, null, 2));
    zip.file('README.txt', ['Hadron Setup (Client App)', '========================', '', 'Extract in your project root. See hadron-client docs for setup.'].join('\n'));
  }

  async function downloadSetupZip() {
    if (!selectedTools.size) return;
    if (!confirm('This will generate a new API key and invalidate the previous one.\n\nContinue?')) return;
    downloading = true;
    try {
      const res = await fetch('/api/regenerate-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stationId: station.id }) });
      if (!res.ok) { alert('Failed to generate API key.'); return; }
      const { rawKey } = await res.json();
      if (!rawKey) { alert('Failed to generate API key.'); return; }
      await generateAndDownloadZip(rawKey);
    } finally { downloading = false; }
  }
</script>

<svelte:head><title>{station.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb + Header -->
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Stations', href: '/app/stations' },
    { label: station.name },
  ]} />

  <div class="flex items-center gap-3">
    <h1 class="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
      <span>{typeIcon[station.stationType] ?? '🔑'}</span>
      {station.name}
    </h1>
    <CopyUrn value={station.urn} />
    {#if !hasWritableMemory && (station.agentSubscriptions?.length ?? 0) > 0}
      <span class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">read-only</span>
    {/if}
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
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

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- CHAT TAB                                                          -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'chat'}
    <div class="flex flex-col" style="min-height: calc(100vh - 280px);">
      {#if chatActive}
        <div class="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden" style="min-height: 400px;">
          {#key chatKey}
            <Chat config={aiConfig} systemPrompt={data.station ? [
              `Station: "${station.name}" (${station.stationType})`,
              `URN: ${station.urn}`,
              (station.agentSubscriptions ?? []).length ? `Agents: ${(station.agentSubscriptions ?? []).map(s => s.agent.name).join(', ')}` : '',
            ].filter(Boolean).join('\n') : ''} />
          {/key}
        </div>
        <div class="mt-2 flex gap-3">
          <button onclick={() => { chatKey++; }} class="text-xs text-zinc-500 hover:text-zinc-300">Restart</button>
          <button onclick={disconnectChat} class="text-xs text-zinc-500 hover:text-zinc-300">Disconnect</button>
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <div class="text-center">
            <p class="mb-4 text-sm text-zinc-500">Configure your AI provider to start chatting.</p>
            <button onclick={() => aiConfigOpen = true} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Set up AI
            </button>
          </div>
        </div>
      {/if}

      <!-- Collapsible AI config -->
      <div class="mt-4">
        <button onclick={() => aiConfigOpen = !aiConfigOpen} class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {aiConfigOpen ? 'rotate-90' : ''}">
            <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
          </svg>
          AI Configuration
        </button>
        {#if aiConfigOpen}
          <div class="mt-3 max-w-md space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <label for="ai-provider" class="mb-1 block text-xs text-zinc-500">Provider</label>
              <select id="ai-provider" value={aiProvider} onchange={onProviderChange}
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                {#each AI_PROVIDERS as p (p.value)}
                  <option value={p.value}>{p.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="ai-key" class="mb-1 block text-xs text-zinc-500">API Key</label>
              <input id="ai-key" type="password" bind:value={aiApiKey} placeholder="sk-..."
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500" />
              <p class="mt-1 text-[10px] text-zinc-400">Encrypted and stored on the server for this station.</p>
            </div>
            <div>
              <label for="ai-model" class="mb-1 block text-xs text-zinc-500">Model</label>
              <input id="ai-model" type="text" bind:value={aiModel}
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-indigo-500 focus:outline-none" />
            </div>
            <button onclick={saveAndStartChat} disabled={!aiApiKey.trim()}
              class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
              {chatActive ? 'Reconnect' : 'Start chat'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- MEMORY TAB                                                        -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'memory'}
    {#if (data.stationNodes ?? []).length === 0}
      <div class="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style="min-height: 400px;">
        No nodes accessible. Subscribe to agents with memories to see the knowledge graph.
      </div>
    {:else}
      <!-- Memory legend -->
      <div class="flex flex-wrap gap-3 mb-2">
        {#each userMemories as mem (mem.id)}
          <div class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {memoryColorMap[mem.urn] ?? '#8b949e'};"></span>
            {mem.name}
            <span class="text-zinc-400">({mem.access})</span>
          </div>
        {/each}
      </div>
      <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" style="min-height: calc(100vh - 320px); display: flex;">
        <TopicGraph data={graphViewData} basePath="" />
      </div>
    {/if}
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- NODES TAB                                                         -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'nodes'}
    <div class="space-y-4">
      <input type="text" placeholder="Filter nodes..." bind:value={nodeSearch}
        class="max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />

      {#if filteredNodes.length === 0}
        <p class="text-sm text-zinc-500">{nodeSearch ? 'No matching nodes.' : 'No nodes accessible by this station.'}</p>
      {:else}
        <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th class="px-4 py-2.5">Node</th>
                <th class="px-4 py-2.5">Memory</th>
                <th class="px-4 py-2.5">Type</th>
                <th class="px-4 py-2.5">Description</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
              {#each filteredNodes as node (node.id)}
                <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                  <td class="px-4 py-2.5">
                    <div class="flex items-center gap-2">
                      <span class="inline-block h-2 w-2 rounded-full" style="background: {memoryColorMap[node.memory?.urn ?? ''] ?? '#8b949e'};"></span>
                      <span class="font-medium text-zinc-900 dark:text-white">{node.name}</span>
                    </div>
                    <p class="mt-0.5 pl-4 font-mono text-xs text-zinc-500">{node.loc}</p>
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">{node.memory?.name ?? '—'}</td>
                  <td class="px-4 py-2.5">
                    <span class="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{node.nodeType}</span>
                  </td>
                  <td class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{node.description ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETUP TAB                                                         -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'setup'}
    <div class="space-y-8">
      <!-- Agents -->
      <section>
        <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Agents
          <span class="ml-1 text-sm font-normal text-zinc-500">({station.agentSubscriptions?.length ?? 0})</span>
        </h2>

        {#if station.agentSubscriptions?.length}
          <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each station.agentSubscriptions as sub (sub.id)}
              {#if editingSubId === sub.id}
                <div class="bg-white px-5 py-4 dark:bg-zinc-900">
                  <div class="mb-3 flex items-center justify-between">
                    <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.agent.name}</p>
                    <form method="POST" action="?/unsubscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                      <input type="hidden" name="agentId" value={sub.agent.id} />
                      <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
                    </form>
                  </div>
                  <form method="POST" action="?/subscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                    <input type="hidden" name="agentId" value={sub.agent.id} />
                    <div class="flex flex-wrap items-end gap-3">
                      <div>
                        <label class="mb-1 block text-xs text-zinc-500">Access</label>
                        <select name="subscriptionType" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                          <option value="READ_ONLY" selected={sub.subscriptionType === 'READ_ONLY'}>Read Only</option>
                          <option value="READ_WRITE" selected={sub.subscriptionType === 'READ_WRITE'}>Read/Write</option>
                        </select>
                      </div>
                      <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
                      <button type="button" onclick={() => { editingSubId = null; }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
                    </div>
                  </form>
                </div>
              {:else}
                <div class="flex w-full items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.agent.name}</p>
                    <CopyUrn value={sub.agent.urn} size={10} />
                  </div>
                  <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {sub.subscriptionType === 'READ_WRITE' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">
                    {sub.subscriptionType === 'READ_WRITE' ? 'read-write' : 'read'}
                  </span>
                  <button type="button" onclick={() => { editingSubId = sub.id; }} class="text-xs text-indigo-500 hover:text-indigo-400">Edit</button>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="mb-4 text-sm text-zinc-500">No agents subscribed yet.</p>
        {/if}

        {#if availableAgents.length > 0}
          <form method="POST" action="?/subscribe" use:enhance class="flex flex-wrap items-end gap-3">
            <div>
              <label for="agentId" class="mb-1 block text-xs text-zinc-500">Agent</label>
              <select id="agentId" name="agentId" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white">
                {#each availableAgents as a (a.id)}
                  <option value={a.id}>{a.name}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="subscriptionType" class="mb-1 block text-xs text-zinc-500">Access</label>
              <select id="subscriptionType" name="subscriptionType" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
                <option value="READ_ONLY">Read Only</option>
                <option value="READ_WRITE">Read/Write</option>
              </select>
            </div>
            <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Add agent</button>
          </form>
        {/if}
      </section>

      <!-- Accessible memories -->
      {#if userMemories.length > 0}
        <section>
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Accessible Memories</h2>
          <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each userMemories as mem (mem.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {memoryColorMap[mem.urn] ?? '#8b949e'};"></span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{mem.name}</p>
                  <CopyUrn value={mem.urn} size={10} />
                </div>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {mem.access === 'read-write' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">{mem.access}</span>
                <span class="text-xs text-zinc-400">via {mem.agentName}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Client config (not for chatbots) -->
      {#if station.stationType !== 'CHATBOT'}
        <section>
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">AI Tools</h2>
          <form method="POST" action="?/updateAgentTools" use:enhance={() => { return async ({ update }) => { await update({ reset: false }); }; }}
            bind:this={agentToolsForm}>
            {#each [...selectedTools] as tool}
              <input type="hidden" name="agentTools" value={tool} />
            {/each}
            <div class="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              {#each AGENT_TOOL_OPTIONS as tool (tool.value)}
                <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={selectedTools.has(tool.value)} onclick={() => toggleTool(tool.value)}
                    class="rounded border-zinc-300 bg-white text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                  {tool.label}
                </label>
              {/each}
            </div>
          </form>

          <div class="mt-4 flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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

          <div class="mt-4">
            <button onclick={downloadSetupZip} disabled={downloading || !selectedTools.size}
              class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? 'Generating...' : 'Download setup files (.zip)'}
            </button>
          </div>
        </section>

        <!-- API Key -->
        <section class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">API Key</h3>
          {#if data.newKey}
            <div class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <p class="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">Copy this key now — it won't be shown again.</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 select-all break-all">{data.newKey}</code>
                <button onclick={() => navigator.clipboard.writeText(data.newKey ?? '')} class="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Copy</button>
              </div>
            </div>
          {:else}
            <p class="mb-3 text-xs text-zinc-500">The API key was shown once when the station was created.</p>
          {/if}
          <form method="POST" action="?/regenerate" use:enhance onsubmit={(e) => {
            if (!confirm('Generate a new API key? The old one will stop working.')) e.preventDefault();
          }}>
            <button type="submit" class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
              {data.newKey ? 'Regenerate again' : 'Generate new API key'}
            </button>
          </form>
        </section>
      {/if}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETTINGS TAB                                                      -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'settings'}
    <div class="max-w-lg space-y-6">
      <!-- Details -->
      <section class="grid gap-3 text-sm sm:grid-cols-2">
        <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-xs text-zinc-500">Type</p>
          <p class="mt-1 font-medium text-zinc-900 dark:text-white">{station.stationType}</p>
        </div>
        <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-xs text-zinc-500">Role</p>
          <p class="mt-1 font-medium text-zinc-900 dark:text-white">{station.role}</p>
        </div>
        <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-xs text-zinc-500">Created</p>
          <p class="mt-1 text-zinc-900 dark:text-white">{new Date(station.createdAt).toLocaleDateString()}</p>
        </div>
        {#if station.lastUsedAt}
          <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="text-xs text-zinc-500">Last used</p>
            <p class="mt-1 text-zinc-900 dark:text-white">{new Date(station.lastUsedAt).toLocaleDateString()}</p>
          </div>
        {/if}
      </section>

      <!-- Edit form -->
      {#if isEditing}
        <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
          class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
          <div>
            <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <input id="editName" name="name" type="text" value={station.name}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
          <div>
            <label for="editType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
            <select id="editType" name="stationType" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="WORKSTATION" selected={station.stationType === 'WORKSTATION'}>Workstation</option>
              <option value="CHATBOT" selected={station.stationType === 'CHATBOT'}>Chatbot</option>
              <option value="AGENT" selected={station.stationType === 'AGENT'}>Agent</option>
              <option value="CLOUD" selected={station.stationType === 'CLOUD'}>Cloud</option>
              <option value="IOT" selected={station.stationType === 'IOT'}>IoT</option>
            </select>
          </div>
          <div>
            <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
            <input id="editDescription" name="description" type="text" value={station.description ?? ''} placeholder="What this station is for"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
          <div class="flex gap-3">
            <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
            <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>
        </form>
      {:else}
        <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          Edit station
        </button>
      {/if}

      <!-- Delete -->
      <section class="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
        <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
          if (!confirm(`Delete station "${station.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
          else goto('/app/stations');
        }}>
          <button type="submit" class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
            Delete station
          </button>
        </form>
      </section>
    </div>
  {/if}
</div>
