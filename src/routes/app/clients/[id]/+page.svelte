<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import JSZip from 'jszip';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const client = $derived(data.client);

  // Collect accessible agents from orgs for the subscribe dropdown
  const subscribedAgentIds = $derived(new Set((client.agentSubscriptions ?? []).map((s) => s.agent.id)));
  const availableAgents = $derived(
    (data.orgs ?? []).flatMap((o) => o.agents ?? []).filter((a) => !subscribedAgentIds.has(a.id))
  );

  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CLOUD: '☁️', IOT: '📡', AGENT: '🤖' };

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
  let selectedTools = $state<Set<string>>(new Set(client.agentTools ?? []));

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
  const mcpUrl = $derived(
    serverUrl.includes('localhost')
      ? serverUrl + '/mcp'
      : serverUrl.replace(/\/$/, '') + '/mcp'
  );

  function mcpConfig(apiKey: string) {
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

  const INSTRUCTIONS_MD = `# Hadron Graph — AI Instructions

This project is connected to Hadron Graph, a knowledge graph platform.
You have access to the following MCP tools:

- **h-find-node** — Search nodes by name, tags, or description
- **h-read-node** — Read a node's full content and edges
- **h-read-next-node** — Navigate to sibling nodes
- **h-create-node** — Create or update a node
- **h-move-node** — Rename or move a node
- **h-run-action** — Load an action node and resolve dependencies
- **h-start-session** / **h-end-session** — Track work sessions
- **h-validate** — Check for broken edges and sparse nodes
- **h-sync-graph** — Trigger a GitHub source sync

Use these tools to read and contribute to the project's knowledge graph.
Start by searching for relevant nodes before creating new ones.
`;

  async function generateAndDownloadZip(apiKey: string) {
    const zip = new JSZip();
    const tools = client.agentTools ?? [];
    const config = mcpConfig(apiKey);
    const configJson = JSON.stringify(config, null, 2);

    if (tools.includes('CLAUDE_CODE')) {
      zip.file('.mcp.json', configJson);
    }
    if (tools.includes('CURSOR')) {
      zip.file('.cursor/mcp.json', configJson);
    }
    if (tools.includes('WINDSURF')) {
      zip.file('.windsurf/mcp.json', configJson);
    }
    if (tools.includes('CLAUDE_DESKTOP')) {
      zip.file('claude_desktop_config.json', configJson);
    }
    if (tools.includes('CODEX')) {
      zip.file('.codex/mcp.json', configJson);
    }
    if (tools.includes('CLINE')) {
      zip.file('.cline/mcp.json', configJson);
    }

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

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hadron-setup-${client.label}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadSetupZip() {
    if (!selectedTools.size) return;
    if (!confirm('This will generate a new API key and invalidate the previous one. Any existing projects using the old setup files will stop working.\n\nContinue?')) return;
    downloading = true;
    try {
      const res = await fetch('/api/regenerate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id }),
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

<svelte:head><title>{client.label} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/clients" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Clients</a>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
        <span>{typeIcon[client.clientType] ?? '🔑'}</span>
        {client.label}
      </h1>
      {#if client.user}
        <p class="text-sm text-zinc-500">Owned by {client.user.name ?? client.user.githubUsername ?? client.user.email}</p>
      {/if}
    </div>
    <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
      if (!confirm(`Delete client "${client.label}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
      else goto('/app/clients');
    }}>
      <button type="submit" class="rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950">Delete</button>
    </form>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Details -->
  <section class="grid gap-3 text-sm sm:grid-cols-2">
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Type</p>
      <p class="mt-1 font-medium text-zinc-900 dark:text-white">{client.clientType}</p>
    </div>
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Role</p>
      <p class="mt-1 font-medium text-zinc-900 dark:text-white">{client.role}</p>
    </div>
    {#if client.expiresAt}
      <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs text-zinc-500">Expires</p>
        <p class="mt-1 font-medium text-yellow-600 dark:text-yellow-300">{new Date(client.expiresAt).toLocaleDateString()}</p>
      </div>
    {/if}
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Created</p>
      <p class="mt-1 text-zinc-900 dark:text-white">{new Date(client.createdAt).toLocaleDateString()}</p>
    </div>
    {#if client.lastUsedAt}
      <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs text-zinc-500">Last used</p>
        <p class="mt-1 text-zinc-900 dark:text-white">{new Date(client.lastUsedAt).toLocaleDateString()}</p>
      </div>
    {/if}
  </section>

  <!-- Agent subscriptions -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Agent Subscriptions
      <span class="ml-1 text-sm font-normal text-zinc-500">({client.agentSubscriptions?.length ?? 0})</span>
    </h2>

    {#if client.agentSubscriptions?.length}
      <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each client.agentSubscriptions as sub (sub.id)}
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
                    <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
                    <select name="subscriptionType" value={sub.subscriptionType} class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
                      <option value="READ_ONLY">Read Only</option>
                      <option value="READ_WRITE">Read/Write</option>
                    </select>
                  </div>
                  <div>
                    <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Training mode</label>
                    <select name="trainingMode" value={sub.trainingMode ? 'true' : 'false'} class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
                      <option value="false">Off</option>
                      <option value="true">On</option>
                    </select>
                  </div>
                  <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
                  <button type="button" onclick={() => { editingSubId = null; }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
                </div>
              </form>
            </div>
          {:else}
            <button
              type="button"
              onclick={() => { editingSubId = sub.id; }}
              class="flex w-full items-center gap-4 bg-white px-5 py-4 text-left transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
            >
              <div class="flex-1 min-w-0">
                <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.agent.name}</p>
                <p class="text-xs text-zinc-500">
                  {sub.subscriptionType === 'READ_WRITE' ? 'Read/Write' : 'Read Only'}
                  {#if sub.trainingMode} · Training mode{/if}
                </p>
              </div>
              <span class="text-xs text-zinc-400">Edit</span>
            </button>
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
              <option value={a.id}>{a.name}</option>
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
        <div>
          <label for="trainingMode" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Training mode</label>
          <select id="trainingMode" name="trainingMode" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Subscribe</button>
      </form>
    {:else}
      <p class="text-sm text-zinc-500">All available agents are already subscribed. Create new agents on the organization page.</p>
    {/if}
  </section>

  <!-- Client Configuration -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Client Configuration</h2>

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

    <div class="mt-4">
      <button onclick={downloadSetupZip}
        disabled={downloading || !selectedTools.size}
        class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
        {downloading ? 'Generating...' : 'Download setup files (.zip)'}
      </button>
      <p class="mt-2 text-xs text-zinc-500">
        {#if selectedTools.size}
          Generates a fresh API key and bundles MCP config files for your selected tools. Extract in your project root.
        {:else}
          Select at least one AI agent tool above to enable download.
        {/if}
      </p>
    </div>
  </section>
</div>
