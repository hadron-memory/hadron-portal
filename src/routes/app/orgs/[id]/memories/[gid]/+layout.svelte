<script lang="ts">
  import { page } from '$app/stores';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}/memories/${data.graph.id}`);

  // Determine which view is active
  const isNodeDetail = $derived($page.url.pathname.match(/\/nodes\/[^/]+/) !== null);
  const isSettings = $derived($page.url.pathname === basePath);

  // If we're on a sub-route (browse, nodes list, or node detail), show Memory tab as active
  const activeTab = $derived(isSettings ? 'settings' : 'memory');
</script>

<div class="space-y-4">
  <!-- Breadcrumb + Header (hidden on node detail pages which have their own) -->
  {#if !isNodeDetail}
  <div class="mb-4">
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: data.org.name, href: `/app/orgs/${data.org.id}` },
      { label: 'Memories', href: `/app/orgs/${data.org.id}/memories` },
      { label: data.graph.name },
    ]} />
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Memory: {data.graph.name}</h1>
    <Urn value={data.graph.urn} type="memory" />
  </div>
  {/if}

  <!-- Tabs (hidden on node detail pages which have their own breadcrumb + layout) -->
  {#if !isNodeDetail}
  <div class="mb-4 flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    <a
      href="{basePath}/browse"
      class="border-b-2 px-4 py-2 text-sm font-medium transition
        {activeTab === 'memory'
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
    >
      Memory
    </a>
    <a
      href={basePath}
      class="border-b-2 px-4 py-2 text-sm font-medium transition
        {activeTab === 'settings'
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
    >
      Settings
    </a>
  </div>
  {/if}

  <!-- Content -->
  {#if isNodeDetail || isSettings}
    <!-- Node detail or Settings: render sub-route directly -->
    {@render children()}
  {:else}
    <!-- Memory browser (Browse/Nodes combined) -->
    <MemoryBrowser nodes={data.graphNodes ?? []} {basePath} />
  {/if}
</div>
