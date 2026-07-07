<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import JSZip from 'jszip';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import AgentChat from '$lib/components/AgentChat.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import { chooseAppChatTabRender } from '$lib/components/app-chat-tab.js';
  import { hasChatSurface as hasChatSurfaceFn } from '$lib/app-surfaces';
  import { t } from '$lib/i18n/t.js';
  import hadronInstructions from '$lib/assets/hadron-instructions.md?raw';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const availableAgents = $derived(data.availableAgents);

  // ── Tab state — driven by App.surfaces (008-agent-installation T071) ─
  // The chat tab appears iff the App's `surfaces` array contains 'chat'.
  // Pre-008 this was gated on `app.appType === 'CHATBOT'`; 008's migration
  // sets `surfaces = ['chat']` for chatbot Apps so existing apps keep their
  // tab without behavior change. Gate logic lives in `$lib/app-surfaces`
  // so it's unit-testable independent of the Svelte component lifecycle.
  type TabId = 'chat' | 'memory' | 'settings' | 'client';
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
  let activeTab = $state<TabId>(hasChatSurface ? 'chat' : 'memory');
  const tabs = $derived<{ id: TabId; label: string }[]>([
    ...(hasChatSurface ? [{ id: 'chat' as TabId, label: 'Chat' }] : []),
    { id: 'memory', label: 'Memory' },
    { id: 'settings', label: 'Settings' },
    ...(!hasChatSurface ? [{ id: 'client' as TabId, label: 'Client' }] : []),
  ]);

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
  let name = $state(app.name);
  let appSlug = $state(slugOfUrn(app.urn));
  let appType = $state(app.appType);
  let role = $state(app.role);
  let description = $state(app.description ?? '');
  let systemPrompt = $state(app.systemPrompt ?? '');
  let createUserPermission = $state(app.createUserPermission);
  let identifyUserMethod = $state(app.identifyUserMethod);
  let sessionTimeoutSeconds = $state(app.sessionTimeoutSeconds);
  let anonymousTtlDays = $state(app.anonymousTtlDays);

  // The edit fields are $state snapshots seeded once at mount, so after a save
  // (enhance runs update() → re-loads + resets the form) they drift from the
  // refreshed `app`. Re-seed from the current `app` every time the form opens
  // (and on cancel) so Edit always reflects live data — fixes the empty/stale
  // fields on the second Edit after a save.
  function syncEditFields() {
    name = app.name;
    appSlug = slugOfUrn(app.urn);
    appType = app.appType;
    role = app.role;
    description = app.description ?? '';
    systemPrompt = app.systemPrompt ?? '';
    createUserPermission = app.createUserPermission;
    identifyUserMethod = app.identifyUserMethod;
    sessionTimeoutSeconds = app.sessionTimeoutSeconds;
    anonymousTtlDays = app.anonymousTtlDays;
  }

  let keyLabel = $state('');
  let selectedAgentId = $state('');

  // 008-agent-installation: an App has at most one Agent (App.agent_id, a
  // direct FK; the AppAgent join was dropped). The "subscribable agents"
  // list is now "agents not yet linked" — empty when an Agent is already set.
  const subscribableAgents = $derived(
    app.agent ? [] : (org.agents ?? [])
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

  const newRawKey = $derived(form?.rawKey as string | undefined);

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
    setTimeout(() => agentToolsForm?.requestSubmit(), 0);
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
        owner: { name: 'Baragaun', email: 'info@baragaun.com' },
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

<svelte:head><title>{app.name} · Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Apps', href: `/app/orgs/${org.id}/apps` },
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

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.updated}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Saved.</div>
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

  <!-- ───────────── MEMORY TAB ───────────── -->
  {#if activeTab === 'memory'}
    <MemoryBrowser nodes={data.appNodes ?? []} multiMemory={true} {writableMemoryIds} />
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
          <form method="POST" action="?/update" use:enhance={() => {
            return async ({ update }) => { editMode = false; await update(); };
          }} class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
            <div>
              <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input id="name" type="text" name="name" bind:value={name} class={inputClass} />
            </div>
            <div>
              <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <div class="flex items-stretch">
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
                <input id="urn" type="text" name="urn" bind:value={appSlug}
                  class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
              </div>
              <p class="mt-1 text-xs text-zinc-400">The slug must be unique within the organization. Changing this rewrites the URN.</p>
            </div>
            <div>
              <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <input id="description" type="text" name="description" bind:value={description} placeholder="What this app is for" class={inputClass} />
            </div>
            <div>
              <label for="systemPrompt" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
              <textarea id="systemPrompt" name="systemPrompt" rows="4" bind:value={systemPrompt}
                placeholder="Instructions for the LLM when using this app"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"></textarea>
              <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each session.</p>
            </div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="appType" name="appType" bind:value={appType}
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
                <select id="editRole" name="role" bind:value={role}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="READER">Reader</option>
                  <option value="CONTRIBUTOR">Contributor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div>
                <label for="cup" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">User creation</label>
                <select id="cup" name="createUserPermission" bind:value={createUserPermission}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="DENY">DENY</option>
                  <option value="EXPLICIT">EXPLICIT</option>
                  <option value="IMPLICIT">IMPLICIT</option>
                </select>
              </div>
              <div>
                <label for="ium" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Identify user by</label>
                <select id="ium" name="identifyUserMethod" bind:value={identifyUserMethod}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="USER_ID">USER_ID</option>
                  <option value="SECRET">SECRET</option>
                </select>
              </div>
              <div>
                <label for="timeout" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Session timeout (seconds)</label>
                <input id="timeout" type="number" name="sessionTimeoutSeconds"
                  bind:value={sessionTimeoutSeconds} min="60" max="86400" class={inputClass} />
              </div>
              <div>
                <label for="anonttl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Anonymous TTL (days)</label>
                <input id="anonttl" type="number" name="anonymousTtlDays"
                  bind:value={anonymousTtlDays} min="1" max="90" class={inputClass} />
              </div>
            </div>
            <div class="flex gap-2">
              <button type="submit" class="rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">Save</button>
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
            <a href="/app/orgs/{org.id}/apps/{app.id}/members"
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
              <form method="POST" action="?/removeAgent" use:enhance class="shrink-0">
                <input type="hidden" name="agentId" value={app.agent.id} />
                <button type="submit" class="text-xs text-red-400 hover:text-red-300">Unlink</button>
              </form>
            </div>
          </div>
        {:else}
          <p class="mb-4 text-sm text-zinc-500">No agent linked yet.</p>
          {#if subscribableAgents.length > 0 || availableAgents.length > 0}
            <form method="POST" action="?/addAgent" use:enhance class="flex flex-wrap items-end gap-3">
              <div class="flex-1 min-w-[200px]">
                <label for="agentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Link an agent</label>
                <select id="agentId" name="agentId" bind:value={selectedAgentId}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="">Select…</option>
                  {#each (subscribableAgents.length > 0 ? subscribableAgents : availableAgents) as a (a.id)}
                    <option value={a.id}>{a.name} ({a.urn})</option>
                  {/each}
                </select>
              </div>
              <button type="submit" disabled={!selectedAgentId}
                class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style="background: #219ebc;">
                Link
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
          members={org.members ?? []}
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

        <form method="POST" action="?/createKey" use:enhance class="mb-5 flex items-end gap-2">
          <div class="flex-1">
            <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Label (optional)</label>
            <input id="label" type="text" name="label" placeholder="e.g. production-backend"
              bind:value={keyLabel} class={inputClass} />
          </div>
          <button type="submit"
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
            + Generate Key
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
                      <form method="POST" action="?/revokeKey" use:enhance
                        onsubmit={(e) => { if (!confirm('Revoke this key? This cannot be undone.')) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={key.id} />
                        <button type="submit"
                          class="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
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
        <form method="POST" action="?/deleteApp" use:enhance={() => {
          return async ({ result, update }) => {
            if (result.type === 'success') goto(`/app/orgs/${org.id}/apps`);
            else await update();
          };
        }} onsubmit={(e) => {
          if (!confirm(`Delete app "${app.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
        }}>
          <button type="submit" class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
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
                <form method="POST" action="?/revokeKey" use:enhance onsubmit={(e) => {
                  if (!confirm(`Revoke key "${key.label ?? 'Unnamed key'}"? It will stop working immediately.`)) e.preventDefault();
                }}>
                  <input type="hidden" name="id" value={key.id} />
                  <button type="submit" class="text-xs text-red-400 hover:text-red-300">Revoke</button>
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
