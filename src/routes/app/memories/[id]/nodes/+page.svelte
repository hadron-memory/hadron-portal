<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/memories/${data.graph.id}`);
  const nodes = $derived(data.graphNodes);
  const usageByNode = $derived(data.usageByNode);

  let search = $state("");
  let sortBy = $state<string>("name");
  let flyoutNode = $state<string | null>(null);

  // Node type filter — INFO checked by default
  const allNodeTypes = ['info', 'data', 'task', 'record', 'chat', 'plan', 'parent'];
  let activeTypes = $state<Set<string>>(new Set(['info']));

  function toggleType(t: string) {
    if (activeTypes.has(t)) {
      activeTypes.delete(t);
    } else {
      activeTypes.add(t);
    }
    activeTypes = new Set(activeTypes);
  }

  // Compute total usage and per-type counts for a node
  function nodeUsageTotal(loc: string): number {
    const u = usageByNode[loc];
    if (!u) return 0;
    return Object.values(u).reduce((sum, c) => sum + c, 0);
  }

  function nodeUsageByType(loc: string, type: string): number {
    return usageByNode[loc]?.[type] ?? 0;
  }

  // Discover all usage types across all nodes
  const allUsageTypes = $derived.by(() => {
    const types = new Set<string>();
    for (const counts of Object.values(usageByNode)) {
      for (const t of Object.keys(counts)) types.add(t);
    }
    return [...types].sort();
  });

  const filtered = $derived(
    nodes.filter((n) => {
      // Type filter (show all if none checked)
      if (activeTypes.size > 0 && !activeTypes.has(n.nodeType ?? 'info')) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        n.name.toLowerCase().includes(q) ||
        n.loc.toLowerCase().includes(q) ||
        (n.description ?? '').toLowerCase().includes(q) ||
        n.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    })
  );

  const sorted = $derived.by(() => {
    const list = [...filtered];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "loc") {
      list.sort((a, b) => a.loc.localeCompare(b.loc));
    } else if (sortBy === "total") {
      list.sort((a, b) => nodeUsageTotal(b.loc) - nodeUsageTotal(a.loc));
    } else {
      // Sort by specific usage type
      list.sort((a, b) => nodeUsageByType(b.loc, sortBy) - nodeUsageByType(a.loc, sortBy));
    }
    return list;
  });

  // Group by domain (first segment of loc)
  const grouped = $derived.by(() => {
    const groups: Record<string, typeof nodes> = {};
    for (const n of sorted) {
      const domain = n.loc.split(':')[0];
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(n);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  });

  const palette = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f97583', '#56d4dd'];
  const domains = $derived([...new Set(nodes.map((n) => n.loc.split(':')[0]))].sort());
  const domainColor = $derived.by(() => {
    const map: Record<string, string> = {};
    domains.forEach((d, i) => { map[d] = palette[i % palette.length]; });
    return map;
  });

  // Flyout data
  const flyoutUsage = $derived.by(() => {
    if (!flyoutNode) return null;
    const u = usageByNode[flyoutNode];
    if (!u) return { loc: flyoutNode, types: [] as { type: string; count: number }[], total: 0 };
    const types = Object.entries(u).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
    const total = types.reduce((s, t) => s + t.count, 0);
    return { loc: flyoutNode, types, total };
  });
</script>

<svelte:head><title>{data.graph.name} &middot; Nodes &middot; Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center gap-4 flex-wrap">
    <input
      type="text"
      placeholder="Filter nodes..."
      bind:value={search}
      class="max-w-sm flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
    />
    <div class="flex items-center gap-1.5 flex-wrap">
      {#each allNodeTypes as t}
        <button
          onclick={() => toggleType(t)}
          class="rounded-full px-2.5 py-0.5 text-xs font-medium transition {activeTypes.has(t) ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}"
        >{t}</button>
      {/each}
    </div>
    <div class="flex items-center gap-2">
      <label for="sortBy" class="text-xs text-zinc-500">Sort by</label>
      <select id="sortBy" bind:value={sortBy} class="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white">
        <option value="name">Name</option>
        <option value="loc">Loc</option>
        <option value="total">Total usage</option>
        {#each allUsageTypes as t}
          <option value={t}>{t} usage</option>
        {/each}
      </select>
    </div>
    <span class="text-sm text-zinc-500">{filtered.length} node{filtered.length !== 1 ? 's' : ''}</span>
  </div>

  {#if grouped.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No nodes found.
    </div>
  {:else}
    {#each grouped as [domain, domainNodes]}
      <div>
        <h2 class="mb-3 flex items-center gap-2 border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:border-zinc-800 dark:text-white">
          <span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {domainColor[domain] ?? '#8b949e'};"></span>
          {domain}
          <span class="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{domainNodes.length}</span>
        </h2>
        <div class="space-y-2">
          {#each domainNodes as node}
            {@const total = nodeUsageTotal(node.loc)}
            {@const reads = nodeUsageByType(node.loc, 'read')}
            {@const writes = nodeUsageByType(node.loc, 'write')}
            <div class="flex items-start gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <a href="{basePath}/nodes/{node.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{node.name}</a>
                  {#if node.isRunnable}
                    <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">runnable</span>
                  {/if}
                </div>
                <p class="mt-0.5 font-mono text-xs text-zinc-500">{node.loc}</p>
                {#if node.description}
                  <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{node.description}</p>
                {/if}
                {#if node.tags.length > 0}
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each node.tags as tag}
                      <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-3">
                {#if total > 0}
                  <button
                    type="button"
                    onclick={() => flyoutNode = flyoutNode === node.loc ? null : node.loc}
                    class="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    title="View usage details"
                  >
                    <span class="text-zinc-500">{total.toLocaleString()}</span>
                    {#if reads > 0}
                      <span class="text-blue-500" title="reads">{reads}r</span>
                    {/if}
                    {#if writes > 0}
                      <span class="text-amber-500" title="writes">{writes}w</span>
                    {/if}
                  </button>
                {/if}
                <a href="{basePath}/nodes/{node.id}" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">View</a>
                <a href="{basePath}/nodes/{node.id}/edit" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</a>
              </div>
            </div>

            {#if flyoutNode === node.loc && flyoutUsage}
              <div class="ml-8 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div class="mb-3 flex items-center justify-between">
                  <h3 class="text-sm font-medium text-zinc-900 dark:text-white">Usage breakdown</h3>
                  <button type="button" onclick={() => flyoutNode = null} class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Close</button>
                </div>
                {#if flyoutUsage.types.length === 0}
                  <p class="text-sm text-zinc-500">No usage events recorded.</p>
                {:else}
                  <div class="space-y-2">
                    {#each flyoutUsage.types as { type, count }}
                      <div class="flex items-center justify-between">
                        <span class="text-sm text-zinc-600 dark:text-zinc-300">{type}</span>
                        <div class="flex items-center gap-2">
                          <div class="h-1.5 rounded-full bg-indigo-500" style="width: {Math.max(4, (count / flyoutUsage.total) * 120)}px;"></div>
                          <span class="text-sm font-mono text-zinc-900 dark:text-white">{count.toLocaleString()}</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                  <div class="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                    <div class="flex items-center justify-between text-sm font-medium">
                      <span class="text-zinc-600 dark:text-zinc-300">Total</span>
                      <span class="font-mono text-zinc-900 dark:text-white">{flyoutUsage.total.toLocaleString()}</span>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>
