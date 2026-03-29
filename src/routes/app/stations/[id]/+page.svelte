<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import JSZip from 'jszip';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const station = $derived(data.station);

  // Collect accessible agents from orgs for the subscribe dropdown
  const subscribedAgentIds = $derived(new Set((station.agentSubscriptions ?? []).map((s) => s.agent.id)));
  const availableAgents = $derived(
    (data.orgs ?? []).flatMap((o) => o.agents ?? []).filter((a) => !subscribedAgentIds.has(a.id))
  );

  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CHATBOT: '💬', CLOUD: '☁️', IOT: '📡', AGENT: '🤖' };
  let isEditing = $state(false);
  let copiedUrn = $state<string | null>(null);

  function copyUrn(urn: string) {
    navigator.clipboard.writeText(urn);
    copiedUrn = urn;
    setTimeout(() => { if (copiedUrn === urn) copiedUrn = null; }, 2000);
  }

  // Compute effective memory access from all agent subscriptions
  interface EffectiveMemory { id: string; urn: string; name: string; access: 'read' | 'read-write'; agentName: string }
  const effectiveMemories = $derived.by(() => {
    const map = new Map<string, EffectiveMemory>();
    for (const sub of station.agentSubscriptions ?? []) {
      for (const item of sub.agent.memoryItems ?? []) {
        const effective = sub.subscriptionType === 'READ_WRITE' && item.role === 'read-write'
          ? 'read-write' as const
          : 'read' as const;
        const existing = map.get(item.memory.id);
        if (!existing || (effective === 'read-write' && existing.access === 'read')) {
          map.set(item.memory.id, {
            id: item.memory.id,
            urn: item.memory.urn,
            name: item.memory.name,
            access: effective,
            agentName: sub.agent.name,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const SYSTEM_MEMORY_URNS = ['hadronmemory.com:core'];
  const systemMemories = $derived(effectiveMemories.filter((m) => SYSTEM_MEMORY_URNS.includes(m.urn)));
  const userMemories = $derived(effectiveMemories.filter((m) => !SYSTEM_MEMORY_URNS.includes(m.urn)));
  const hasWritableMemory = $derived(effectiveMemories.some((m) => m.access === 'read-write'));

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
  let selectedTools = $state<Set<string>>(new Set(station.agentTools ?? []));
  let withClientApp = $state(false);

  function toggleTool(value: string) {
    if (selectedTools.has(value)) {
      selectedTools.delete(value);
    } else {
      selectedTools.add(value);
    }
    selectedTools = new Set(selectedTools); // trigger reactivity
    setTimeout(() => agentToolsForm?.requestSubmit(), 0);
  }

  // ── Zip download ──────────────────────────────────────────────────────
  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
  const clientAppUrl = 'http://localhost:3200';
  const mcpBaseUrl = $derived(withClientApp ? clientAppUrl : serverUrl);
  const mcpUrl = $derived(
    mcpBaseUrl.includes('localhost')
      ? mcpBaseUrl + '/mcp'
      : mcpBaseUrl.replace(/\/$/, '') + '/mcp'
  );

  // ── Config builders ────────────────────────────────────────────────

  /** MCP config for direct server connection (without client app) */
  function directMcpConfig(apiKey: string) {
    return {
      mcpServers: {
        hadron: {
          type: 'http',
          url: mcpUrl,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    };
  }

  /** MCP config for hadron-client app (localhost proxy) */
  function clientAppMcpConfig(apiKey: string) {
    return {
      mcpServers: {
        hadron: {
          url: `${clientAppUrl}/mcp`,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    };
  }

  /** Claude Code hooks config for hadron-client */
  function claudeCodeHooksConfig() {
    return {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/session-start`, timeout: 5 }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/before-prompt`, timeout: 5 }] }],
        PostToolUse: [{ matcher: 'mcp__hadron', hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/after-tool`, timeout: 5 }] }],
        PostCompact: [{ hooks: [{ type: 'http', url: `${clientAppUrl}/hooks/post-compact`, timeout: 5 }] }],
      },
    };
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

  // ── Zip generation ──────────────────────────────────────────────────

  async function generateAndDownloadZip(apiKey: string) {
    const zip = new JSZip();
    const tools = station.agentTools ?? [];

    if (withClientApp) {
      generateClientAppZip(zip, tools, apiKey);
    } else {
      generateDirectZip(zip, tools, apiKey);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hadron-setup-${station.name}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Zip contents for direct server connection (no client app) */
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

    const readmeLines = [
      'Hadron Graph — Setup Files',
      '==========================',
      '',
      'Extract this zip in your project root.',
      '',
    ];
    if (tools.includes('CLAUDE_CODE')) {
      readmeLines.push('Claude Code:  Add the following line to your CLAUDE.md:');
      readmeLines.push('              @import .hadron/INSTRUCTIONS.md');
      readmeLines.push('');
    }
    if (tools.includes('CURSOR')) {
      readmeLines.push('Cursor:       Copy the contents of .hadron/INSTRUCTIONS.md');
      readmeLines.push('              into your .cursorrules file.');
      readmeLines.push('');
    }
    if (tools.includes('WINDSURF')) {
      readmeLines.push('Windsurf:     Copy the contents of .hadron/INSTRUCTIONS.md');
      readmeLines.push('              into your .windsurfrules file.');
      readmeLines.push('');
    }
    if (tools.includes('CLAUDE_DESKTOP')) {
      readmeLines.push('Claude Desktop: Move claude_desktop_config.json to:');
      readmeLines.push('              macOS: ~/Library/Application Support/Claude/');
      readmeLines.push('              Windows: %APPDATA%\\Claude\\');
      readmeLines.push('');
    }
    readmeLines.push('Your API key is embedded in the config files.');
    readmeLines.push('Keep these files private — do not commit them to public repos.');
    zip.file('README.txt', readmeLines.join('\n'));
  }

  /** Zip contents for hadron-client app (localhost proxy) */
  function generateClientAppZip(zip: JSZip, tools: string[], apiKey: string) {
    const config = clientAppMcpConfig(apiKey);
    const configJson = JSON.stringify(config, null, 2);

    // MCP config files per tool
    if (tools.includes('CLAUDE_CODE'))    zip.file('.claude/mcp.json', configJson);
    if (tools.includes('CURSOR'))         zip.file('.cursor/mcp.json', configJson);
    if (tools.includes('WINDSURF'))       zip.file('.windsurf/mcp.json', configJson);
    if (tools.includes('CLAUDE_DESKTOP')) zip.file('claude_desktop_config.json', configJson);
    if (tools.includes('CODEX'))          zip.file('.codex/mcp.json', configJson);
    if (tools.includes('CLINE'))          zip.file('.cline/mcp.json', configJson);

    // Claude Code hooks (hadron-client injects prompts via hooks)
    if (tools.includes('CLAUDE_CODE')) {
      zip.file('.claude/settings.json', JSON.stringify(claudeCodeHooksConfig(), null, 2));
    }

    // hadron-client local config
    zip.file('.hadron/config.json', JSON.stringify({
      stationKey: apiKey,
      defaultLevel: 'guided',
    }, null, 2));

    const readmeLines = [
      'Hadron Graph — Setup Files (Client App)',
      '========================================',
      '',
      'Extract this zip in your project root.',
      '',
      '1. Install hadron-client',
      '   cd /path/to/your/project',
      '   git clone git@github.com:hadron-memory/hadron-client.git /tmp/hadron-client',
      '   cd /tmp/hadron-client',
      '   pnpm install',
      '   pnpm build',
      '',
      '2. Initialize your project',
      '   cd /path/to/your/project',
      '   node /tmp/hadron-client/dist/cli.js init',
      '',
      '   This walks you through:',
      '     - Enter your client key',
      '     - Pick a default level (basic/guided/learn)',
      '     - Optionally configure Claude Code (writes .claude/mcp.json and .claude/settings.json)',
      '   It creates .hadron/config.json in your project and adds .hadron/sessions/ to .gitignore.',
      '',
      '3. Start the client app',
      '   node /tmp/hadron-client/dist/cli.js start',
      '   The server runs on port 3200. Keep it running while you use Claude Code.',
      '',
    ];
    if (tools.includes('CLAUDE_CODE')) {
      readmeLines.push('Claude Code:  MCP config and hooks are in .claude/');
      readmeLines.push('              Hooks enable structured work phases and feedback.');
      readmeLines.push('');
    }
    if (tools.includes('CURSOR')) {
      readmeLines.push('Cursor:       MCP config is in .cursor/mcp.json');
      readmeLines.push('');
    }
    if (tools.includes('WINDSURF')) {
      readmeLines.push('Windsurf:     MCP config is in .windsurf/mcp.json');
      readmeLines.push('');
    }
    if (tools.includes('CLAUDE_DESKTOP')) {
      readmeLines.push('Claude Desktop: Move claude_desktop_config.json to:');
      readmeLines.push('              macOS: ~/Library/Application Support/Claude/');
      readmeLines.push('              Windows: %APPDATA%\\Claude\\');
      readmeLines.push('');
    }
    readmeLines.push('Your station key is in .hadron/config.json and the MCP config files.');
    readmeLines.push('Keep these files private — do not commit them to public repos.');
    zip.file('README.txt', readmeLines.join('\n'));
  }

  async function downloadSetupZip() {
    if (!selectedTools.size) return;
    if (!confirm('This will generate a new API key and invalidate the previous one. Any existing projects using the old setup files will stop working.\n\nContinue?')) return;
    downloading = true;
    try {
      const res = await fetch('/api/regenerate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: station.id }),
      });
      if (!res.ok) {
        alert('Failed to generate API key. Please try again.');
        return;
      }
      const { rawKey } = await res.json();
      if (!rawKey) {
        alert('Failed to generate API key. Please try again.');
        return;
      }
      await generateAndDownloadZip(rawKey);
    } finally {
      downloading = false;
    }
  }
</script>

<svelte:head><title>{station.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Breadcrumb -->
  <nav class="flex items-center gap-1 text-sm flex-wrap">
    <a href="/app/dashboard" class="text-indigo-500 hover:underline dark:text-indigo-400">Dashboard</a>
    <span class="text-zinc-400">/</span>
    <a href="/app/stations" class="text-indigo-500 hover:underline dark:text-indigo-400">Stations</a>
    <span class="text-zinc-400">/</span>
    <span class="text-zinc-700 dark:text-zinc-300">{station.name}</span>
  </nav>

  <div class="flex items-start justify-between">
    <div>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
        <span>{typeIcon[station.stationType] ?? '🔑'}</span>
        <span class="text-zinc-400 font-normal">Station:</span> {station.name}
      </h1>
      <div class="flex items-center gap-2 mt-1">
        <code class="font-mono text-sm text-zinc-500">{station.urn}</code>
        <button onclick={() => navigator.clipboard.writeText(station.urn)} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
      {#if station.user}
        <p class="text-sm text-zinc-500">Owned by {station.user.name ?? station.user.githubUsername ?? station.user.email}</p>
      {/if}
      {#if !hasWritableMemory && (station.agentSubscriptions?.length ?? 0) > 0}
        <p class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          This is a read-only station with no writable memory.
        </p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if !isEditing}
        <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
      <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
        if (!confirm(`Delete station "${station.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
        else goto('/app/stations');
      }}>
        <button type="submit" class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">Delete</button>
      </form>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Edit form -->
  {#if isEditing}
    <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
      class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4 max-w-lg"
    >
      <div>
        <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
        <input id="editName" name="name" type="text" value={station.name}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
      </div>
      <div>
        <label for="editType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
        <select id="editType" name="stationType" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="WORKSTATION" selected={station.stationType === 'WORKSTATION'}>💻 Workstation</option>
          <option value="CHATBOT" selected={station.stationType === 'CHATBOT'}>💬 Chatbot</option>
          <option value="AGENT" selected={station.stationType === 'AGENT'}>🤖 Agent</option>
          <option value="CLOUD" selected={station.stationType === 'CLOUD'}>☁️ Cloud</option>
          <option value="IOT" selected={station.stationType === 'IOT'}>📡 IoT</option>
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
  {/if}

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
    {#if station.expiresAt}
      <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs text-zinc-500">Expires</p>
        <p class="mt-1 font-medium text-yellow-600 dark:text-yellow-300">{new Date(station.expiresAt).toLocaleDateString()}</p>
      </div>
    {/if}
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

  <!-- Agent subscriptions -->
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
                <p class="font-mono text-xs text-zinc-400">{sub.agent.urn}</p>
                <form method="POST" action="?/unsubscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                  <input type="hidden" name="agentId" value={sub.agent.id} />
                  <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
              <form method="POST" action="?/subscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                <input type="hidden" name="agentId" value={sub.agent.id} />
                <div class="flex flex-wrap items-end gap-3">
                  <div>
                    <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
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
              <span class="w-3.5 shrink-0">
                {#if sub.subscriptionType === 'READ_ONLY'}
                  <span title="Read only"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
                {/if}
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.agent.name}</p>
                <div class="flex items-center gap-1">
                  <p class="font-mono text-xs text-zinc-400">{sub.agent.urn}</p>
                  <button onclick={() => copyUrn(sub.agent.urn)} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
                    {#if copiedUrn === sub.agent.urn}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    {:else}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    {/if}
                  </button>
                </div>
                {#if sub.agent.description}
                  <p class="text-xs text-zinc-500">{sub.agent.description}</p>
                {/if}
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
      <p class="mb-4 text-sm text-zinc-500">No agent subscriptions yet.</p>
    {/if}

    <h3 class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Add subscription</h3>
    {#if availableAgents.length > 0}
      <form method="POST" action="?/subscribe" use:enhance class="flex flex-wrap items-end gap-3">
        <div>
          <label for="agentId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Agent</label>
          <select id="agentId" name="agentId" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white">
            {#each availableAgents as a (a.id)}
              <option value={a.id}>{a.name} ({a.urn})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="subscriptionType" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
          <select id="subscriptionType" name="subscriptionType" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READ_ONLY">Read Only</option>
            <option value="READ_WRITE">Read/Write</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Subscribe</button>
      </form>
    {:else}
      <p class="text-sm text-zinc-500">All available agents are already subscribed. Create new agents on the organization page.</p>
    {/if}
  </section>

  <!-- Accessible memories -->
  {#if userMemories.length > 0}
    <section>
      <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Accessible Memories
        <span class="ml-1 text-sm font-normal text-zinc-500">({userMemories.length})</span>
      </h2>
      <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each userMemories as mem (mem.id)}
          <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
            <span class="w-3.5 shrink-0">
              {#if mem.access === 'read'}
                <span title="Read only"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{mem.name}</p>
              <div class="flex items-center gap-1">
                <p class="font-mono text-xs text-zinc-400">{mem.urn}</p>
                <button onclick={() => copyUrn(mem.urn)} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
                  {#if copiedUrn === mem.urn}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  {:else}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  {/if}
                </button>
              </div>
            </div>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {mem.access === 'read-write' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">{mem.access}</span>
            <span class="shrink-0 text-xs text-zinc-400">via {mem.agentName}</span>
          </div>
        {/each}
      </div>
      {#if systemMemories.length > 0}
        <div class="mt-3">
          <p class="mb-1 text-xs text-zinc-400">System memories (always available, read-only):</p>
          {#each systemMemories as mem (mem.id)}
            <p class="text-xs text-zinc-400"><span class="font-mono">{mem.urn}</span> — {mem.name}</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <!-- Station Configuration (not shown for chatbots) -->
  {#if station.stationType !== 'CHATBOT'}
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Station Configuration</h2>

    <form method="POST" action="?/updateAgentTools" use:enhance={() => {
        return async ({ update }) => { await update({ reset: false }); };
      }}
      bind:this={agentToolsForm}>
      {#each [...selectedTools] as tool}
        <input type="hidden" name="agentTools" value={tool} />
      {/each}
      <div class="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {#each AGENT_TOOL_OPTIONS as tool (tool.value)}
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox"
              checked={selectedTools.has(tool.value)}
              onclick={() => toggleTool(tool.value)}
              class="rounded border-zinc-300 bg-white text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
            {tool.label}
          </label>
        {/each}
      </div>
    </form>

    <div class="mt-4 flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Client mode:</span>
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <input type="radio" name="clientMode" checked={withClientApp}
          onchange={() => { withClientApp = true; }}
          class="text-indigo-500 focus:ring-indigo-500" />
        With Hadron Client App
      </label>
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
        <input type="radio" name="clientMode" checked={!withClientApp}
          onchange={() => { withClientApp = false; }}
          class="text-indigo-500 focus:ring-indigo-500" />
        Without app
      </label>
    </div>

    <div class="mt-4">
      <button onclick={downloadSetupZip}
        disabled={downloading || !selectedTools.size}
        class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
        {downloading ? 'Generating...' : 'Download setup files (.zip)'}
      </button>
      <p class="mt-2 text-xs text-zinc-500">
        {#if selectedTools.size}
          Generates a fresh API key and bundles setup files for your selected tools.
          {#if withClientApp}
            Includes MCP config, hooks, and .hadron/config.json for the Hadron Client App (localhost:3200).
          {:else}
            Configured for direct server connection. Extract in your project root.
          {/if}
        {:else}
          Select at least one AI agent tool above to enable download.
        {/if}
      </p>
    </div>

    <!-- API Key section -->
    <div class="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">API Key</h3>
      {#if data.newKey}
        <div class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p class="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">Copy this key now — it won't be shown again.</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 rounded bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 select-all break-all">{data.newKey}</code>
            <button onclick={() => navigator.clipboard.writeText(data.newKey ?? '')} class="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Copy
            </button>
          </div>
        </div>
        <p class="mb-3 text-xs text-zinc-500">MCP endpoint: <code class="font-mono">{mcpUrl}</code></p>
      {:else}
        <p class="mb-3 text-xs text-zinc-500">The API key was shown once when the station was created. Generate a new one if needed.</p>
      {/if}
      <form method="POST" action="?/regenerate" use:enhance onsubmit={(e) => {
        if (!confirm('This will generate a new API key and invalidate the previous one. Continue?')) e.preventDefault();
      }}>
        <button type="submit" class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          {data.newKey ? 'Regenerate again' : 'Generate new API key'}
        </button>
      </form>
    </div>
  </section>
  {/if}
</div>
