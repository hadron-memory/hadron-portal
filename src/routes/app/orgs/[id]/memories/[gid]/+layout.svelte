<script lang="ts">
  import { page } from '$app/stores';
  import TreeView from '$lib/components/TreeView.svelte';
  import CopyUrn from '$lib/components/CopyUrn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}/memories/${data.graph.id}`);

  const tabs = $derived([
    { href: `${basePath}/browse`, label: 'Browse' },
    { href: `${basePath}/nodes`, label: 'Nodes' },
    { href: basePath, label: 'Settings', exact: true },
  ]);

  function isTabActive(tab: { href: string; exact?: boolean }) {
    const path = $page.url.pathname;
    if (tab.exact) return path === tab.href;
    return path.startsWith(tab.href);
  }

  // If we're on the exact basePath (no sub-route), the default view is Browse
  const isBrowseActive = $derived($page.url.pathname.startsWith(`${basePath}/browse`));
  const isNodesActive = $derived($page.url.pathname.startsWith(`${basePath}/nodes`));
  const showTree = $derived(isBrowseActive || isNodesActive);

  let treeOpen = $state(true);
</script>

<div class="space-y-4">
  <!-- Breadcrumb + Header -->
  <div class="mb-4">
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: data.org.name, href: `/app/orgs/${data.org.id}` },
      { label: 'Memories', href: `/app/orgs/${data.org.id}/memories` },
      { label: data.graph.name },
    ]} />
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{data.graph.name}</h1>
    <CopyUrn value={data.graph.urn} />
  </div>

  <!-- Tabs -->
  <div class="mb-4 flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab}
      <a
        href={tab.href}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {isTabActive(tab)
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >
        {tab.label}
      </a>
    {/each}
  </div>

  <!-- Content with optional tree sidebar -->
  {#if showTree}
    <div class="flex gap-4" style="min-height: calc(100vh - 220px);">
      <!-- Tree sidebar -->
      {#if treeOpen}
        <aside class="w-64 shrink-0 overflow-y-auto rounded-l-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
          <div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tree</span>
            <button onclick={() => treeOpen = false} class="text-zinc-500 hover:text-zinc-300" title="Close tree">&times;</button>
          </div>
          <TreeView entries={data.treeEntries} {basePath} />
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

      <!-- Main content -->
      <div class="min-w-0 flex-1">
        {@render children()}
      </div>
    </div>
  {:else}
    {@render children()}
  {/if}
</div>
