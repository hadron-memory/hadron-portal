<script lang="ts">
  import TreeView from './TreeView.svelte';
  import TopicGraph from './TopicGraph.svelte';
  import { graphState } from './GraphState.svelte';
  import { buildGraphViewData, buildTreeEntries } from '$lib/graph-utils';
  import { onDestroy } from 'svelte';
  import type { MemoryNode } from '$lib/types';

  let {
    nodes,
    basePath = '',
    multiMemory = false,
  }: {
    nodes: MemoryNode[];
    basePath?: string;
    multiMemory?: boolean;
  } = $props();

  // ── Sub-view ──────────────────────────────────────────────────────────
  let activeView = $state<'graph' | 'nodes'>('graph');
  let treeOpen = $state(true);

  // Keyword search — shared with TreeView and TopicGraph via graphState
  let keyword = $state('');
  $effect(() => { graphState.searchFilter = keyword; });
  onDestroy(() => { graphState.searchFilter = ''; });

  // ── Filters ───────────────────────────────────────────────────────────
  const availableMemoryUrns = $derived([...new Set(nodes.map((n) => n.memory?.urn ?? ''))].filter(Boolean).sort());
  const availableNodeTypes = $derived([...new Set(nodes.map((n) => n.nodeType ?? 'info'))].sort());

  let activeMemoryUrns = $state<Set<string>>(new Set());
  let activeNodeTypes = $state<Set<string>>(new Set());

  function toggleMemory(urn: string) {
    if (activeMemoryUrns.has(urn)) activeMemoryUrns.delete(urn);
    else activeMemoryUrns.add(urn);
    activeMemoryUrns = new Set(activeMemoryUrns);
  }

  function toggleNodeType(t: string) {
    if (activeNodeTypes.has(t)) activeNodeTypes.delete(t);
    else activeNodeTypes.add(t);
    activeNodeTypes = new Set(activeNodeTypes);
  }

  // ── Filtered nodes ────────────────────────────────────────────────────
  const filteredNodes = $derived(
    nodes.filter((n) => {
      if (activeMemoryUrns.size > 0 && !activeMemoryUrns.has(n.memory?.urn ?? '')) return false;
      if (activeNodeTypes.size > 0 && !activeNodeTypes.has(n.nodeType ?? 'info')) return false;
      return true;
    })
  );

  const searchedNodes = $derived(
    filteredNodes.filter((n) => {
      if (!keyword) return true;
      const q = keyword.toLowerCase();
      return n.name.toLowerCase().includes(q) || n.loc.toLowerCase().includes(q) || (n.description ?? '').toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q));
    })
  );

  // ── Derived views ─────────────────────────────────────────────────────
  const graphViewData = $derived(buildGraphViewData(filteredNodes));
  const treeEntries = $derived(buildTreeEntries(filteredNodes));

  // ── Memory colors ─────────────────────────────────────────────────────
  const memoryColors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f97583', '#56d4dd'];
  const memoryColorMap = $derived.by(() => {
    const map: Record<string, string> = {};
    const urns = [...new Set(nodes.map((n) => n.memory?.urn ?? ''))];
    urns.forEach((u, i) => { map[u] = memoryColors[i % memoryColors.length]; });
    return map;
  });

  // Memory name lookup
  const memoryNameMap = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      if (n.memory?.urn && n.memory.name) map[n.memory.urn] = n.memory.name;
    }
    return map;
  });
</script>

<div class="flex flex-col gap-3">
  <!-- Filter bar -->
  <div class="flex flex-wrap items-center gap-4">
    {#if multiMemory && availableMemoryUrns.length > 1}
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-xs text-zinc-500 mr-1">Memory:</span>
        {#each availableMemoryUrns as urn}
          <button
            onclick={() => toggleMemory(urn)}
            class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition {activeMemoryUrns.size === 0 || activeMemoryUrns.has(urn) ? '' : 'opacity-40'}"
            style="background: {memoryColorMap[urn] ?? '#8b949e'}20; color: {memoryColorMap[urn] ?? '#8b949e'};"
          >
            <span class="inline-block h-2 w-2 rounded-full" style="background: {memoryColorMap[urn] ?? '#8b949e'};"></span>
            {memoryNameMap[urn] ?? urn}
          </button>
        {/each}
        {#if activeMemoryUrns.size > 0}
          <button onclick={() => { activeMemoryUrns = new Set(); }} class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">clear</button>
        {/if}
      </div>
    {/if}

    {#if availableNodeTypes.length > 1}
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-xs text-zinc-500 mr-1">Type:</span>
        {#each availableNodeTypes as t}
          <button
            onclick={() => toggleNodeType(t)}
            class="rounded-full px-2.5 py-0.5 text-xs font-medium transition {activeNodeTypes.size === 0 || activeNodeTypes.has(t) ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600'}"
          >{t}</button>
        {/each}
        {#if activeNodeTypes.size > 0}
          <button onclick={() => { activeNodeTypes = new Set(); }} class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">clear</button>
        {/if}
      </div>
    {/if}

    <!-- Sub-view toggle + search -->
    <div class="ml-auto flex items-center gap-3">
      <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
        <button
          onclick={() => activeView = 'graph'}
          class="px-2.5 py-1 text-xs {activeView === 'graph' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
        >Graph</button>
        <button
          onclick={() => activeView = 'nodes'}
          class="px-2.5 py-1 text-xs {activeView === 'nodes' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
        >Nodes</button>
      </div>
      <input type="text" placeholder="Search..." bind:value={keyword}
        class="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      <span class="text-xs text-zinc-400">{searchedNodes.length}{searchedNodes.length !== nodes.length ? ` / ${nodes.length}` : ''}</span>
    </div>
  </div>

  <!-- Main area: tree + content -->
  {#if nodes.length === 0}
    <div class="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style="min-height: 400px;">
      No nodes to display.
    </div>
  {:else}
    <div class="flex gap-0" style="min-height: calc(100vh - 320px);">
      <!-- Tree sidebar -->
      {#if treeOpen}
        <aside class="w-64 shrink-0 overflow-y-auto rounded-l-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
          <div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tree</span>
            <button onclick={() => treeOpen = false} class="text-zinc-500 hover:text-zinc-300" title="Close tree">&times;</button>
          </div>
          <TreeView entries={treeEntries} {basePath} hideSearch={true} />
        </aside>
      {:else}
        <button
          onclick={() => treeOpen = true}
          class="mr-2 self-start rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Show tree"
        >
          Tree &rsaquo;
        </button>
      {/if}

      <!-- Content -->
      <div class="min-w-0 flex-1 overflow-hidden {treeOpen ? 'rounded-r-lg' : 'rounded-lg'} border border-zinc-200 dark:border-zinc-800">
        {#if activeView === 'graph'}
          <div style="display: flex; height: 100%;">
            {#key filteredNodes.length + ':' + [...activeMemoryUrns].join(',') + ':' + [...activeNodeTypes].join(',')}
              <TopicGraph data={graphViewData} {basePath} />
            {/key}
          </div>
        {:else}
          <div class="overflow-x-auto">
            {#if searchedNodes.length === 0}
              <div class="p-8 text-center text-sm text-zinc-500">{keyword ? 'No matching nodes.' : 'No nodes.'}</div>
            {:else}
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <th class="px-4 py-2.5">Node</th>
                    {#if multiMemory}<th class="px-4 py-2.5">Memory</th>{/if}
                    <th class="px-4 py-2.5">Type</th>
                    <th class="px-4 py-2.5">Description</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {#each searchedNodes as node (node.id)}
                    <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                      <td class="px-4 py-2.5">
                        <div class="flex items-center gap-2">
                          {#if multiMemory}
                            <span class="inline-block h-2 w-2 rounded-full" style="background: {memoryColorMap[node.memory?.urn ?? ''] ?? '#8b949e'};"></span>
                          {/if}
                          {#if basePath}
                            <a href="{basePath}/nodes/{encodeURIComponent(node.loc)}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{node.name}</a>
                          {:else}
                            <span class="font-medium text-zinc-900 dark:text-white">{node.name}</span>
                          {/if}
                        </div>
                        <p class="mt-0.5 pl-4 font-mono text-xs text-zinc-500">{node.loc}</p>
                      </td>
                      {#if multiMemory}
                        <td class="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">{node.memory?.name ?? '—'}</td>
                      {/if}
                      <td class="px-4 py-2.5">
                        <span class="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{node.nodeType}</span>
                      </td>
                      <td class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{node.description ?? '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
