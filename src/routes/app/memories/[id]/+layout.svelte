<script lang="ts">
  import { page } from '$app/stores';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/memories/${data.graph.id}`);

  // #260: org context comes from the memory's owning org, which may be one the
  // user isn't a member of (org is then null). Only link the section crumb back
  // to that org's list when the user is a member; otherwise render it as text.
  const orgListHref = $derived(
    data.org ? `/app/orgs/${data.org.id}/${data.graph.class === 'system' ? 'agents' : 'memories'}` : undefined,
  );

  // Determine which view is active
  const isNodeDetail = $derived($page.url.pathname.match(/\/nodes\/[^/]+/) !== null);
  const isSettings = $derived($page.url.pathname === basePath);

  // If we're on a sub-route (browse, nodes list, or node detail), show Memory tab as active
  const activeTab = $derived(isSettings ? 'settings' : 'memory');
</script>

<div class="space-y-4">
  <!-- Breadcrumb + Header (hidden on node detail pages which have their own) -->
  {#if !isNodeDetail}
  {@const isAgentSystem = data.graph.class === 'system'}
  <div class="mb-4">
    <Breadcrumb items={[
      { label: isAgentSystem ? 'Agents' : 'Memories', href: orgListHref },
      { label: data.graph.name },
    ]} />
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
      <span class="text-zinc-400 font-normal">{isAgentSystem ? 'Agent system:' : 'Memory:'}</span> {data.graph.name}
    </h1>
    <Urn value={data.graph.urn} type="memory" />
    {#if isAgentSystem && data.graph.agent}
      <p class="mt-1 text-xs text-zinc-500">
        Owned by agent
        <a href={`/app/agents/${data.graph.agent.id}`} class="text-indigo-500 hover:underline">{data.graph.agent.name}</a>
      </p>
    {/if}
  </div>
  {/if}

  <!-- Tabs (hidden on node detail pages and on the create-node form,
       which both have their own breadcrumb + focused layout — note
       isNodeDetail's regex /\/nodes\/[^/]+/ matches /nodes/new too) -->
  {#if !isNodeDetail}
  <div class="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
    <div class="flex gap-0">
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
    <a
      href="{basePath}/nodes/new"
      class="mb-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
    >
      {createNodeStrings.newNodeButton()}
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
