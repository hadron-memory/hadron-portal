<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const setup = $derived(data.setup);
  const mcpUrl = $derived(
    data.controllerUrl.includes('localhost')
      ? data.controllerUrl + '/mcp'
      : data.controllerUrl.replace(/\/$/, '') + '/mcp'
  );

  let selectedTool = $state('claude-desktop');
  let copied = $state(false);

  const tools = [
    { id: 'claude-desktop', name: 'Claude Desktop', path: '~/Library/Application Support/Claude/claude_desktop_config.json', pathWin: '%APPDATA%\\Claude\\claude_desktop_config.json' },
    { id: 'claude-code', name: 'Claude Code', path: '.mcp.json (in project root)', pathWin: '.mcp.json (in project root)' },
    { id: 'cursor', name: 'Cursor', path: '.cursor/mcp.json (in project root)', pathWin: '.cursor\\mcp.json (in project root)' },
    { id: 'windsurf', name: 'Windsurf', path: '.windsurf/mcp.json (in project root)', pathWin: '.windsurf\\mcp.json (in project root)' },
  ];

  const configContent = $derived.by(() => {
    if (!setup.apiKey) return '';
    return JSON.stringify({
      mcpServers: {
        hadron: {
          type: 'http',
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${setup.apiKey}`,
          },
        },
      },
    }, null, 2);
  });

  const selectedToolInfo = $derived(tools.find((t) => t.id === selectedTool)!);

  function copyConfig() {
    navigator.clipboard.writeText(configContent);
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
  }

  function downloadConfig() {
    const blob = new Blob([configContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filenames: Record<string, string> = {
      'claude-desktop': 'claude_desktop_config.json',
      'claude-code': 'mcp.json',
      'cursor': 'mcp.json',
      'windsurf': 'mcp.json',
    };
    a.download = filenames[selectedTool] ?? 'mcp-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Set up your AI · Hadron</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8 py-8">
  <div>
    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white">Your AI workspace is ready</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">
      Connect your AI tool to Hadron in three steps.
    </p>
  </div>

  {#if !setup.hasSetup}
    <div class="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-zinc-500">Your workspace is ready. You can generate a new API key from the dashboard.</p>
      <a href="/app/dashboard" class="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
        Go to dashboard
      </a>
    </div>
  {:else}
    <!-- Step 1: Choose your tool -->
    <section class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-4 flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-white">
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">1</span>
        Choose your AI tool
      </h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each tools as tool}
          <button
            type="button"
            onclick={() => selectedTool = tool.id}
            class="rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors
              {selectedTool === tool.id
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300'
                : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}"
          >
            {tool.name}
          </button>
        {/each}
      </div>
    </section>

    <!-- Step 2: Download config -->
    <section class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-4 flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-white">
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">2</span>
        Download your config file
      </h2>
      <div class="rounded-lg bg-zinc-950 p-4">
        <pre class="overflow-x-auto text-sm text-green-400">{configContent}</pre>
      </div>
      <div class="mt-4 flex gap-3">
        <button onclick={downloadConfig} class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
          Download {tools.find((t) => t.id === selectedTool)?.name} config
        </button>
        <button onclick={copyConfig} class="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </section>

    <!-- Step 3: Place the file -->
    <section class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-4 flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-white">
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">3</span>
        Place the file and restart
      </h2>
      <div class="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <p>Save the downloaded file to:</p>
        <p class="rounded-lg bg-zinc-100 px-4 py-2 font-mono text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200">
          {selectedToolInfo.path}
        </p>
        <p class="mt-3">Then restart {selectedToolInfo.name}. Your AI will now have access to your Hadron memories.</p>
      </div>
    </section>

    <!-- API key warning -->
    <div class="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700 dark:bg-amber-950">
      <p class="text-sm font-medium text-amber-800 dark:text-amber-300">
        Your API key is shown only once. Save the config file now — you won't be able to see this key again.
      </p>
    </div>

    {#if setup.graphs && setup.graphs.length > 0}
      <section>
        <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Your memories</h2>
        <div class="space-y-2">
          {#each setup.graphs as memory}
            <div class="rounded-lg border border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <span class="font-mono text-sm text-indigo-600 dark:text-indigo-300">{memory.name}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <div class="flex justify-center pt-4">
      <a href="/app/dashboard" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
        Go to dashboard →
      </a>
    </div>
  {/if}
</div>
