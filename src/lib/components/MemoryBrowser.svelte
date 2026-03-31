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
    writableMemoryIds = [],
  }: {
    nodes: MemoryNode[];
    basePath?: string;
    multiMemory?: boolean;
    writableMemoryIds?: string[];
  } = $props();

  const writableSet = $derived(new Set(writableMemoryIds));

  // ── Sub-view ──────────────────────────────────────────────────────────
  let activeView = $state<'graph' | 'nodes'>('graph');
  let treeOpen = $state(true);
  let treeWidth = $state(256);
  let dragging = $state(false);

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMove(ev: MouseEvent) {
      treeWidth = Math.max(150, Math.min(500, startWidth + ev.clientX - startX));
    }
    function onUp() {
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Keyword search — shared with TreeView and TopicGraph via graphState
  let keyword = $state('');
  $effect(() => { graphState.searchFilter = keyword; });
  onDestroy(() => { graphState.searchFilter = ''; });

  // ── Filters ───────────────────────────────────────────────────────────
  const availableMemoryUrns = $derived([...new Set(nodes.map((n) => n.memory?.urn ?? ''))].filter(Boolean).sort());
  const availableNodeTypes = $derived([...new Set(nodes.map((n) => n.nodeType ?? 'info'))].sort());
  const availableTags = $derived([...new Set(nodes.flatMap((n) => n.tags ?? []))].sort());

  let activeMemoryUrns = $state<Set<string>>(new Set());
  let activeNodeTypes = $state<Set<string>>(new Set());
  let activeTags = $state<Set<string>>(new Set());

  // Dropdown open state
  let openDropdown = $state<'memory' | 'type' | 'tags' | null>(null);

  function toggleDropdown(d: 'memory' | 'type' | 'tags') {
    openDropdown = openDropdown === d ? null : d;
  }

  function handleWindowClick(e: MouseEvent) {
    if (openDropdown && !(e.target as Element)?.closest?.('.filter-dropdown')) {
      openDropdown = null;
    }
  }

  const hasActiveFilters = $derived(activeMemoryUrns.size > 0 || activeNodeTypes.size > 0 || activeTags.size > 0 || keyword.length > 0);

  function clearAllFilters() {
    activeMemoryUrns = new Set();
    activeNodeTypes = new Set();
    activeTags = new Set();
    keyword = '';
  }

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

  function toggleTag(t: string) {
    if (activeTags.has(t)) activeTags.delete(t);
    else activeTags.add(t);
    activeTags = new Set(activeTags);
  }

  // ── Filtered nodes ────────────────────────────────────────────────────
  const filteredNodes = $derived(
    nodes.filter((n) => {
      if (activeMemoryUrns.size > 0 && !activeMemoryUrns.has(n.memory?.urn ?? '')) return false;
      if (activeNodeTypes.size > 0 && !activeNodeTypes.has(n.nodeType ?? 'info')) return false;
      if (activeTags.size > 0 && !(n.tags ?? []).some((t) => activeTags.has(t))) return false;
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
  // Deduplicate by loc (multiple memories can have nodes at the same loc)
  const uniqueFilteredNodes = $derived.by(() => {
    const seen = new Map<string, typeof filteredNodes[0]>();
    for (const n of filteredNodes) {
      if (!seen.has(n.loc)) seen.set(n.loc, n);
    }
    return [...seen.values()];
  });

  const rawGraphViewData = $derived(buildGraphViewData(uniqueFilteredNodes));
  const treeEntries = $derived(buildTreeEntries(uniqueFilteredNodes));

  // Color rules: multiple memories → color by memory; multiple selected types → color by type; otherwise same color
  const graphViewData = $derived.by(() => {
    const gv = rawGraphViewData;
    const memoryUrns = [...new Set(filteredNodes.map((n) => n.memory?.urn ?? ''))].filter(Boolean);
    const hasMultiMemory = multiMemory && memoryUrns.length > 1;
    const hasMultiTypeFilter = activeNodeTypes.size > 1;

    // Walk up loc path to find a parent's domain
    function findParentDomain(id: string, map: Record<string, string>): string {
      const parts = id.split(':');
      for (let i = parts.length - 1; i > 0; i--) {
        const parent = parts.slice(0, i).join(':');
        if (map[parent]) return map[parent];
      }
      return 'all';
    }

    // Build read-only map from writable memory IDs
    const readOnlyMap: Record<string, boolean> = {};
    if (writableSet.size > 0) {
      for (const n of uniqueFilteredNodes) {
        readOnlyMap[n.loc] = !writableSet.has(n.memoryId);
      }
    }

    // Helper: remap domain on both topics and folderNodes, and mark read-only
    function remapDomains(domainFn: (id: string) => string) {
      return {
        ...gv,
        topics: gv.topics.map((t) => ({ ...t, domain: domainFn(t.id), readOnly: readOnlyMap[t.id] ?? false })),
        folderNodes: gv.folderNodes.map((f) => ({ ...f, domain: domainFn(f.id) })),
      };
    }

    if (hasMultiTypeFilter) {
      const nodeTypeMap: Record<string, string> = {};
      for (const n of uniqueFilteredNodes) { nodeTypeMap[n.loc] = n.nodeType ?? 'info'; }
      return remapDomains((id) => nodeTypeMap[id] ?? findParentDomain(id, nodeTypeMap));
    }

    if (hasMultiMemory) {
      const memMap: Record<string, string> = {};
      for (const n of uniqueFilteredNodes) { memMap[n.loc] = n.memory?.name ?? n.memory?.urn ?? ''; }
      // Also map folder nodes to their parent's memory
      return remapDomains((id) => memMap[id] ?? findParentDomain(id, memMap));
    }

    // Single color
    return remapDomains(() => 'all');
  });

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

<svelte:window onclick={handleWindowClick} />

<div class="flex flex-col gap-3">
  <!-- Filter bar -->
  <div class="flex items-center gap-2 flex-wrap">
    <!-- Memory dropdown -->
    {#if multiMemory && availableMemoryUrns.length > 1}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('memory')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeMemoryUrns.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Memories {#if activeMemoryUrns.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeMemoryUrns.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'memory' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'memory'}
          <div class="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeMemoryUrns.size > 0}
              <button onclick={() => { activeMemoryUrns = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableMemoryUrns as urn}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeMemoryUrns.has(urn)} onchange={() => toggleMemory(urn)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                <span class="inline-block h-2 w-2 rounded-full shrink-0" style="background: {memoryColorMap[urn] ?? '#8b949e'};"></span>
                <span class="truncate">{memoryNameMap[urn] ?? urn}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Node type dropdown -->
    {#if availableNodeTypes.length > 1}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('type')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeNodeTypes.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Node Types {#if activeNodeTypes.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeNodeTypes.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'type' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'type'}
          <div class="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeNodeTypes.size > 0}
              <button onclick={() => { activeNodeTypes = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableNodeTypes as t}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeNodeTypes.has(t)} onchange={() => toggleNodeType(t)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                {t}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tags dropdown -->
    {#if availableTags.length > 0}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('tags')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeTags.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Tags {#if activeTags.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeTags.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'tags' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'tags'}
          <div class="absolute left-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeTags.size > 0}
              <button onclick={() => { activeTags = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableTags as t}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeTags.has(t)} onchange={() => toggleTag(t)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                {t}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Search -->
    <input type="text" placeholder="Search..." bind:value={keyword}
      class="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />

    {#if hasActiveFilters}
      <button onclick={clearAllFilters} class="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Clear all</button>
    {/if}

    <!-- Right: view toggle + count -->
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
        <aside class="shrink-0 overflow-y-auto rounded-l-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="width: {treeWidth}px;">
          <div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tree</span>
            <button onclick={() => treeOpen = false} class="text-zinc-500 hover:text-zinc-300" title="Close tree">&times;</button>
          </div>
          <TreeView entries={treeEntries} {basePath} hideSearch={true} />
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-indigo-400 transition-colors dark:bg-zinc-800 dark:hover:bg-indigo-500"
          class:bg-indigo-400={dragging}
          class:dark:bg-indigo-500={dragging}
          onmousedown={startDrag}
        ></div>
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
            {#key uniqueFilteredNodes.length + ':' + [...activeMemoryUrns].join(',') + ':' + [...activeNodeTypes].join(',') + ':' + [...activeTags].join(',') + ':' + keyword}
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
                            <span class="inline-block h-2 w-2 rounded-full {writableSet.size > 0 && !writableSet.has(node.memoryId) ? 'opacity-30' : ''}" style="background: {memoryColorMap[node.memory?.urn ?? ''] ?? '#8b949e'};"></span>
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
