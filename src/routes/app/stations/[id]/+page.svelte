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
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/stations" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Stations</a>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
        <span>{typeIcon[station.stationType] ?? '🔑'}</span>
        {station.name}
      </h1>
      {#if station.user}
        <p class="text-sm text-zinc-500">Owned by {station.user.name ?? station.user.githubUsername ?? station.user.email}</p>
      {/if}
    </div>
    <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
      if (!confirm(`Delete station "${station.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
      else goto('/app/stations');
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
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Agent Subscriptions
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
                <p class="font-mono text-xs text-zinc-400">{sub.agent.urn}</p>
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

  <!-- Station Configuration -->
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
  </section>
</div>
