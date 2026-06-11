<script lang="ts">
  // #266: memory-detail is a tab layout. The layout renders the breadcrumb +
  // header + tab bar; each tab is a sub-route rendered via {@render children()}.
  import { page } from '$app/stores';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
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

  const path = $derived($page.url.pathname);
  // Node detail / create pages bring their own chrome — hide the tab layout there
  // (the regex matches /nodes/<id> and /nodes/new).
  const isNodeDetail = $derived(/\/nodes\/[^/]+/.test(path));
  const tabs = $derived([
    { id: 'info', label: t('memory-detail.tab.info', 'Info'), href: `${basePath}/info` },
    { id: 'nodes', label: t('memory-detail.tab.nodes', 'Nodes'), href: `${basePath}/nodes` },
    { id: 'graph', label: t('memory-detail.tab.graph', 'Graph'), href: `${basePath}/graph` },
    { id: 'settings', label: t('memory-detail.tab.settings', 'Settings'), href: `${basePath}/settings` },
    { id: 'integrations', label: t('memory-detail.tab.integrations', 'Integrations'), href: `${basePath}/integrations` },
    { id: 'subscriptions', label: t('memory-detail.tab.subscriptions', 'Subscriptions'), href: `${basePath}/subscriptions` },
  ]);

  // The active tab is the sub-route's last segment (falls back to nodes).
  const activeTab = $derived(tabs.find((tb) => path === tb.href)?.id ?? 'nodes');
</script>

<div class="space-y-4">
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

    <div class="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
      <div class="flex gap-0">
        {#each tabs as tab (tab.id)}
          <a
            href={tab.href}
            class="border-b-2 px-4 py-2 text-sm font-medium transition
              {activeTab === tab.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
          >{tab.label}</a>
        {/each}
      </div>
      <a
        href="{basePath}/nodes/new"
        class="mb-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {createNodeStrings.newNodeButton()}
      </a>
    </div>
  {/if}

  <!-- Nodes/Graph share one MemoryBrowser rendered HERE (in the persistent
       layout) so its tree width, open/closed, search, and filters survive
       switching between the two tabs (the page components would remount). The
       page components only set the <title>. -->
  {#if !isNodeDetail && (activeTab === 'nodes' || activeTab === 'graph')}
    <MemoryBrowser nodes={data.graphNodes ?? []} {basePath} forcedView={activeTab} />
  {/if}
  {@render children()}
</div>
