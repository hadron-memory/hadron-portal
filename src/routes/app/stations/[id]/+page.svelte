<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import JSZip from 'jszip';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import { chatContext } from '$lib/stores/chat-context';
  import { AI_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import type { AIProvider, StationAIConfig } from '$lib/types';
  import Chat from '$lib/components/Chat.svelte';
  import hadronInstructions from '$lib/assets/hadron-instructions.md?raw';
  import hadronConfigSample from '$lib/assets/config.sample.yml?raw';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const station = $derived(data.station);

  // ── Tab state ──────────────────────────────────────────────────────────
  type TabId = 'chat' | 'memory' | 'settings' | 'client';
  const isChatbot = $derived(station.stationType === 'CHATBOT');
  let activeTab = $state<TabId>(station.stationType === 'CHATBOT' ? 'chat' : 'memory');
  const tabs = $derived<{ id: TabId; label: string }[]>([
    ...(isChatbot ? [{ id: 'chat' as TabId, label: 'Chat' }] : []),
    { id: 'memory', label: 'Memory' },
    { id: 'settings', label: 'Settings' },
    ...(!isChatbot ? [{ id: 'client' as TabId, label: 'Client' }] : []),
  ]);

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
  const writableMemoryIds = $derived(effectiveMemories.filter((m) => m.access === 'read-write').map((m) => m.id));


  // ── AI chat config ─────────────────────────────────────────────────────
  let aiProvider = $state<AIProvider>((station.aiProvider as AIProvider) ?? 'openai');
  let aiApiKey = $state('');
  let aiModel = $state(station.aiModel ?? DEFAULT_MODELS['openai']);
  let chatActive = $state(false);
  let chatKey = $state(0);
  let aiEditing = $state(false);
  let memoriesOpen = $state(false);

  let aiConfig = $derived<StationAIConfig>({ provider: aiProvider, apiKey: aiApiKey, model: aiModel });

  // Load saved AI config on mount — auto-start chat if config exists
  onMount(async () => {
    if (station.hasAiApiKey) {
      try {
        const res = await fetch(`/api/stations/ai-config?stationId=${station.id}`);
        if (res.ok) {
          const { provider, apiKey, model } = await res.json();
          if (provider && apiKey && model) {
            aiProvider = provider as AIProvider;
            aiApiKey = apiKey;
            aiModel = model;
            chatKey++;
            chatActive = true;
          }
        }
      } catch { /* ignore */ }
    }
  });

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
  }

  function disconnectChat() { chatActive = false; }

  // ── Client tab state ────────────────────────────────────────────────────
  // Project-level tools (configs go into project directory)
  // Global-only tools (configs must be merged into a global file)
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
  let selectedTools = $derived(new Set(station.agentTools ?? []));
  let withClientApp = $state(false);
  let newKeyLabel = $state('');
  let stationKeys = $state<typeof data.stationKeys>([]);

  // Keep keys in sync when data changes (e.g. after form action)
  $effect(() => { stationKeys = data.stationKeys ?? []; });


  const activeKeys = $derived(stationKeys.filter((k) => !k.revokedAt));
  let newKeySectionOpen = $state(false);

  // Sanitize label the same way the server does
  function sanitizeLabel(label: string): string {
    return (label || 'key').replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/-+/g, '-').toLowerCase();
  }

  // Build a masked key display: sanitized-label/datestamp/••••••••last4
  function maskedKey(label: string | null, createdAt: string, keyPreview: string | null): string {
    const sanitized = sanitizeLabel(label ?? 'key');
    const dateStamp = new Date(createdAt).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const masked = keyPreview ? `${'••••••••'}${keyPreview}` : '••••••••••••';
    return `${sanitized}/${dateStamp}/${masked}`;
  }

  // #73: Validation for new key name
  const trimmedLabel = $derived(newKeyLabel.trim());
  const sanitizedNewLabel = $derived(sanitizeLabel(trimmedLabel));
  const duplicateKeyName = $derived(
    trimmedLabel.length > 0 && activeKeys.some((k) => sanitizeLabel(k.label ?? 'key') === sanitizedNewLabel)
  );
  const canDownload = $derived(trimmedLabel.length > 0 && !duplicateKeyName && selectedTools.size > 0);

  // #73: Key preview while typing — show sanitized-label/datestamp-placeholder/masked
  const keyPreviewText = $derived(
    trimmedLabel.length > 0 ? `${sanitizedNewLabel}/${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}/••••••••••••` : ''
  );

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

  // ── Per-tool MCP config generators ────────────────────────────────────

  // Claude Code: .mcp.json (project root)
  // Uses stdio transport — hadron-client launched as subprocess
  function claudeCodeMcpConfig(_url: string, apiKey: string) {
    return { mcpServers: { hadron: { command: 'hadron-client', args: ['stdio'], env: { HADRON_CLIENT_KEY: apiKey } } } };
  }

  // GitHub Copilot: .vscode/mcp.json (project)
  // Uses "servers" wrapper with "type": "http"
  function copilotMcpConfig(url: string, apiKey: string) {
    return { servers: { hadron: { type: 'url', url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } }, inputs: [] };
  }

  // Cursor: .cursor/mcp.json (project)
  // Uses mcpServers with "url" field
  function cursorMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }

  // Windsurf: ~/.codeium/windsurf/mcp_config.json (global only)
  // Uses "serverUrl" field
  function windsurfMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }

  // Antigravity: global only, same format as Windsurf
  function antigravityMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }

  function claudeCodeHooksConfig() {
    return { hooks: {
      SessionStart: [{ hooks: [{ type: 'url', url: `${clientAppUrl}/hooks/session-start`, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'url', url: `${clientAppUrl}/hooks/before-prompt`, timeout: 5 }] }],
      PostToolUse: [{ matcher: 'mcp__hadron', hooks: [{ type: 'url', url: `${clientAppUrl}/hooks/after-tool`, timeout: 5 }] }],
      PostCompact: [{ hooks: [{ type: 'url', url: `${clientAppUrl}/hooks/post-compact`, timeout: 5 }] }],
    }};
  }

  const INSTRUCTIONS_MD = hadronInstructions;

  async function generateAndDownloadZip(apiKey: string, keyLabel: string) {
    const zip = new JSZip();
    const tools = station.agentTools ?? [];
    const url = mcpUrl;

    // ── Claude Code: generate plugin directory ──────────────────────────
    if (tools.includes('CLAUDE_CODE')) {
      const pluginManifest: Record<string, unknown> = {
        name: 'hadron',
        version: '1.0.0',
        description: `Hadron knowledge memory for station "${station.name}"`,
        author: { name: 'Baragaun', url: 'https://hadronmemory.com' },
        homepage: 'https://hadronmemory.com',
        license: 'MIT',
        keywords: ['hadron', 'memory', 'knowledge-graph', 'mcp'],
      };

      // Add hooks if using client app
      if (withClientApp) {
        pluginManifest.hooks = claudeCodeHooksConfig().hooks;
      }

      // MCP config — goes at project root as .mcp.json (plugin MCP server loading is unreliable)
      const mcpConfig = claudeCodeMcpConfig(url, apiKey);

      // Marketplace manifest (required for /plugins marketplace add)
      const marketplaceManifest = {
        name: 'hadron',
        owner: { name: 'Baragaun', email: 'info@baragaun.com' },
        metadata: { description: 'Hadron knowledge memory plugins' },
        plugins: [{
          name: 'hadron',
          source: './plugins/hadron',
          description: `Hadron knowledge memory for station "${station.name}"`,
          version: '1.0.0',
          author: { name: 'Baragaun' },
        }],
      };

      zip.file('hadron-plugin/.claude-plugin/marketplace.json', JSON.stringify(marketplaceManifest, null, 2));
      zip.file('hadron-plugin/plugins/hadron/.claude-plugin/plugin.json', JSON.stringify(pluginManifest, null, 2));
      // MCP config at project root — user copies this to their project
      zip.file('.mcp.json', JSON.stringify(mcpConfig, null, 2));

      // Add a getting-started skill
      zip.file('hadron-plugin/plugins/hadron/skills/get-started/SKILL.md',
`---
name: get-started
description: Learn how to use Hadron knowledge memory in this project
---

You are helping the user get started with Hadron, a knowledge memory platform for AI agents.

This project is connected to Hadron station "${station.name}".

Available MCP tools:
- **h-start-session** / **h-end-session** — Track work sessions
- **h-find-node** — Search nodes by name, tags, or description
- **h-read-node** — Read a node's full content and edges
- **h-read-next-node** — Navigate to the next sibling node
- **h-create-node** — Create or update a node
- **h-update-node** — Partially update a node
- **h-move-node** — Rename or move a node
- **h-validate** — Validate graph structure
- **h-sync-graph** — Trigger a sync from the git source

Start by calling h-start-session, then use h-find-node to explore what knowledge is available.
When you learn something new, save it with h-create-node or h-update-node.
`);

      // Add a search skill
      zip.file('hadron-plugin/plugins/hadron/skills/search/SKILL.md',
`---
name: search
description: Search the Hadron knowledge graph
---

Search the Hadron knowledge graph for relevant information.
Use h-find-node with the user's query to find matching nodes, then read the most relevant ones with h-read-node.
Present the results concisely.
`);
    }

    // ── Claude Code: also add standalone .mcp.json as fallback ─────────
    if (tools.includes('CLAUDE_CODE'))
      zip.file('.mcp.json', JSON.stringify(claudeCodeMcpConfig(url, apiKey), null, 2));
    if (tools.includes('COPILOT'))
      zip.file('.vscode/mcp.json', JSON.stringify(copilotMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CURSOR'))
      zip.file('.cursor/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));

    // ── Project-level configs (TODO: update formats) ─────────────────
    if (tools.includes('CLAUDE_DESKTOP'))
      zip.file('claude_desktop_config.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CODEX'))
      zip.file('.codex/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CLINE'))
      zip.file('.cline/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));

    // ── Global-only configs (user must merge manually) ─────────────────
    if (tools.includes('WINDSURF'))
      zip.file('global-configs/windsurf-mcp_config.json', JSON.stringify(windsurfMcpConfig(url, apiKey), null, 2));
    if (tools.includes('ANTIGRAVITY'))
      zip.file('global-configs/antigravity-mcp_config.json', JSON.stringify(antigravityMcpConfig(url, apiKey), null, 2));

    // ── Client App extras ──────────────────────────────────────────────
    if (withClientApp) {
      // Hooks for Claude Code are now in the plugin manifest (hadron-plugin/.claude-plugin/plugin.json)
      // For non-plugin users, also provide standalone settings.json
      if (tools.includes('CLAUDE_CODE'))
        zip.file('.claude/settings.json', JSON.stringify(claudeCodeHooksConfig(), null, 2));
      zip.file('.hadron/config.json', JSON.stringify({ stationKey: apiKey, defaultLevel: 'guided' }, null, 2));
    }

    // ── Common files ───────────────────────────────────────────────────
    zip.file('.hadron/INSTRUCTIONS.md', INSTRUCTIONS_MD);
    zip.file('.hadron/config.yml', hadronConfigSample);

    // hadron-client wrapper script — must be on PATH for .mcp.json to work
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
      readmeLines.push(
        '',
        '### Claude Code',
        '',
        '1. Copy `.mcp.json` to your project root',
        '2. Copy `hadron-plugin/` into your project',
        '3. Install the plugin:',
        '   ```',
        '   /plugins marketplace add ./hadron-plugin',
        '   ```',
        '   Then install "hadron" from the Plugins tab.',
      );
    if (tools.includes('COPILOT'))
      readmeLines.push(
        '',
        '### GitHub Copilot',
        '',
        '- Copy `.vscode/mcp.json` to your project',
        '- Docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers',
      );
    if (tools.includes('CURSOR'))
      readmeLines.push(
        '',
        '### Cursor',
        '',
        '- Copy `.cursor/mcp.json` to your project',
        '- Docs: https://cursor.com/docs/mcp',
      );
    if (tools.includes('CLAUDE_DESKTOP'))
      readmeLines.push(
        '',
        '### Claude Desktop',
        '',
        '- Merge `claude_desktop_config.json` into your Claude Desktop config',
      );
    if (tools.includes('CODEX'))
      readmeLines.push(
        '',
        '### Codex CLI',
        '',
        '- Copy `.codex/mcp.json` to your project',
      );
    if (tools.includes('CLINE'))
      readmeLines.push(
        '',
        '### Cline',
        '',
        '- Copy `.cline/mcp.json` to your project',
      );
    if (hasGlobalTools) {
      readmeLines.push(
        '',
        '### Global-only configs',
        '',
        'These tools only support global MCP configuration.',
        'Merge the hadron entry from the `global-configs/` folder into your existing config file.',
      );
      if (tools.includes('WINDSURF'))
        readmeLines.push(
          '',
          '**Windsurf:** Merge into `~/.codeium/windsurf/mcp_config.json`',
        );
      if (tools.includes('ANTIGRAVITY'))
        readmeLines.push(
          '',
          '**Antigravity:** Merge into `~/.antigravity/mcp_config.json`',
        );
    }
    if (withClientApp) readmeLines.push(
      '',
      '### Hadron Client App',
      '',
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
      const res = await fetch('/api/create-station-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: station.id, label }),
      });
      if (!res.ok) { alert('Failed to create client key.'); return; }
      const { key, rawKey } = await res.json();
      if (!rawKey) { alert('Failed to create client key.'); return; }
      // Add the new key to the local list immediately
      stationKeys = [{ ...key, stationId: station.id, userId: station.userId ?? '', lastUsedAt: null, revokedAt: null }, ...stationKeys];
      newKeyLabel = '';
      await generateAndDownloadZip(rawKey, label);
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
    <div>
      <h1 class="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
        <span>{typeIcon[station.stationType] ?? '🔑'}</span>
        {station.name}
        {#if !hasWritableMemory && (station.agentSubscriptions?.length ?? 0) > 0}
          <span class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">read-only</span>
        {/if}
      </h1>
      <Urn value={station.urn} type="station" />
    </div>
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
    <div class="flex flex-col" style="height: calc(100vh - 280px);">
      {#if chatActive}
        <div class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {#key chatKey}
            <Chat config={aiConfig} stationId={station.id} systemPrompt={data.station ? [
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
            <p class="mb-4 text-sm text-zinc-500">Configure your AI provider in Settings to start chatting.</p>
            <button onclick={() => activeTab = 'settings'} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Go to Settings
            </button>
          </div>
        </div>
      {/if}

    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- MEMORY TAB (shared MemoryBrowser component)                       -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'memory'}
    <MemoryBrowser nodes={data.stationNodes ?? []} multiMemory={true} {writableMemoryIds} />
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETTINGS TAB (agents, memories, AI config, properties, edit, delete) -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'settings'}
    <div class="max-w-lg space-y-8">
      <!-- Properties -->
      <section>
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">Station</h2>
          {#if !isEditing}
            <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
          {/if}
        </div>

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
              <label for="editRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
              <select id="editRole" name="role" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="READER" selected={station.role === 'READER'}>Reader</option>
                <option value="CONTRIBUTOR" selected={station.role === 'CONTRIBUTOR'}>Contributor</option>
                <option value="ADMIN" selected={station.role === 'ADMIN'}>Admin</option>
              </select>
            </div>
            <div>
              <label for="editUrn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <input id="editUrn" name="urn" type="text" value={station.urn} placeholder="e.g. myorg:my-station"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
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
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Type</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{station.stationType}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Role</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{station.role}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">URN</span>
              <span class="text-sm font-mono text-zinc-900 dark:text-white">{station.urn}</span>
            </div>
            {#if station.description}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Description</span>
                <span class="text-sm text-zinc-900 dark:text-white">{station.description}</span>
              </div>
            {/if}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Created</span>
              <span class="text-sm text-zinc-900 dark:text-white">{new Date(station.createdAt).toLocaleDateString()}</span>
            </div>
            {#if station.lastUsedAt}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Last used</span>
                <span class="text-sm text-zinc-900 dark:text-white">{new Date(station.lastUsedAt).toLocaleDateString()}</span>
              </div>
            {/if}
          </div>
        {/if}
      </section>

      <!-- Agents -->
      <section>
        <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Agents
          <span class="ml-1 text-sm font-normal text-zinc-500">({station.agentSubscriptions?.length ?? 0})</span>
        </h2>

        {#if station.agentSubscriptions?.length}
          <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each station.agentSubscriptions as sub (sub.id)}
              <div class="flex w-full items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="text-base">🤖</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{sub.agent.name}</p>
                  <Urn value={sub.agent.urn} type="agent" size={10} />
                </div>
                <form method="POST" action="?/subscribe" use:enhance class="shrink-0">
                  <input type="hidden" name="agentId" value={sub.agent.id} />
                  <select name="subscriptionType"
                    onchange={(e) => e.currentTarget?.form?.requestSubmit()}
                    class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="READ_ONLY" selected={sub.subscriptionType === 'READ_ONLY'}>Read Only</option>
                    <option value="READ_WRITE" selected={sub.subscriptionType === 'READ_WRITE'}>Read/Write</option>
                  </select>
                </form>
                <form method="POST" action="?/unsubscribe" use:enhance class="shrink-0">
                  <input type="hidden" name="agentId" value={sub.agent.id} />
                  <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
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

      <!-- Accessible memories (collapsed by default) -->
      {#if userMemories.length > 0}
        <section>
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

      <!-- AI Chat Configuration (chatbot only) -->
      {#if isChatbot}
      <section>
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">AI Chat</h2>
          {#if !aiEditing}
            <button onclick={() => aiEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
          {/if}
        </div>

        {#if aiEditing}
          <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-3">
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
            <div class="flex gap-3">
              <button onclick={() => { saveAndStartChat(); aiEditing = false; }} disabled={!aiApiKey.trim()}
                class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                Save
              </button>
              <button type="button" onclick={() => aiEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
            </div>
          </div>
        {:else}
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Provider</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{station.aiProvider ?? '—'}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Model</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{station.aiModel ?? '—'}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">API Key</span>
              <span class="text-sm text-zinc-900 dark:text-white">{station.hasAiApiKey ? 'Configured' : 'Not set'}</span>
            </div>
          </div>
        {/if}
      </section>
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

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- CLIENT TAB (keys list, new key + plugin download)                 -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'client'}
    <div class="max-w-lg space-y-8">
      {#if station.stationType !== 'CHATBOT'}

        <!-- Client Keys list -->
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
                  <form method="POST" action="?/revokeKey" use:enhance onsubmit={(e) => {
                    if (!confirm(`Revoke key "${key.label ?? 'Unnamed key'}"? It will stop working immediately.`)) e.preventDefault();
                  }}>
                    <input type="hidden" name="keyId" value={key.id} />
                    <button type="submit" class="text-xs text-red-400 hover:text-red-300">Revoke</button>
                  </form>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-zinc-500">No active keys. Create one below to get started.</p>
          {/if}
        </section>

        <!-- New Client Key + Download (collapsible when keys exist) -->
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
            <!-- Key name -->
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

            <!-- Plugin selection -->
            <div>
              <span class="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Include plugins</span>
              <form method="POST" action="?/updateAgentTools" use:enhance={() => { return async ({ update }) => { await update({ reset: false }); }; }}
                bind:this={agentToolsForm}>
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

            <!-- Client mode -->
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

            <!-- Download button -->
            <button onclick={downloadSetupZip} disabled={downloading || !canDownload}
              class="w-full rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? 'Generating...' : 'Download setup files (.zip)'}
            </button>
            <p class="text-[10px] text-zinc-400">Creates a new client key and downloads a zip with the selected plugin configs. Extract in your project root.</p>
          </div>
          {/if}
        </section>

      {:else}
        <p class="text-sm text-zinc-500">Client configuration is not available for chatbot stations.</p>
      {/if}
    </div>
  {/if}
</div>
