<script lang="ts">
  // #336: org-detail is a tab layout (mirrors /app/memories/[id]). The layout
  // renders the breadcrumb + header + tab bar; each tab is a sub-route rendered
  // via {@render children()}.
  import { page } from '$app/stores';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}`);

  // Consumer-mode users only get the dashboard + memories (matches the sidebar
  // nav in app/+layout.svelte); the admin sub-routes redirect them away anyway.
  const tabs = $derived(
    data.isConsumerMode
      ? [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
          { id: 'memories', label: t('org-detail.tab.memories', 'Memories'), href: `${basePath}/memories` },
        ]
      : [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
          { id: 'memories', label: t('org-detail.tab.memories', 'Memories'), href: `${basePath}/memories` },
          { id: 'agents', label: t('org-detail.tab.agents', 'Agents'), href: `${basePath}/agents` },
          { id: 'apps', label: t('org-detail.tab.apps', 'Apps'), href: `${basePath}/apps` },
          { id: 'team', label: t('org-detail.tab.team', 'Team'), href: `${basePath}/members` },
          { id: 'integrations', label: t('org-detail.tab.integrations', 'Integrations'), href: `${basePath}/integrations` },
          { id: 'usage', label: t('org-detail.tab.usage', 'Usage'), href: `${basePath}/sessions` },
        ],
  );

  // The tab chrome is shown only on the tab routes themselves. Deeper pages
  // (e.g. /memories/new, /apps/[appId], /create-chatbot, /exchange/...) bring
  // their own full-page chrome — match on exact pathname so they opt out.
  const path = $derived($page.url.pathname);
  const activeTab = $derived(tabs.find((tb) => path === tb.href));
  const showChrome = $derived(!!activeTab);
</script>

<div class="space-y-4">
  {#if showChrome}
    <div class="mb-4">
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        { label: data.org.name },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        <span class="font-normal text-zinc-400">Organization:</span> {data.org.name}
      </h1>
      <Urn value={data.org.urn} type="org" />
    </div>

    <div class="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
      <div class="flex gap-0">
        {#each tabs as tab (tab.id)}
          <a
            href={tab.href}
            class="border-b-2 px-4 py-2 text-sm font-medium transition
              {activeTab?.id === tab.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
          >{tab.label}</a>
        {/each}
      </div>
    </div>
  {/if}

  {@render children()}
</div>
