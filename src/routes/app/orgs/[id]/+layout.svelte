<script lang="ts">
  // #336: org-detail is a tab layout. The layout renders the breadcrumb +
  // header + tab bar; each tab is a sub-route rendered via {@render children()}.
  //
  // The tabs cover the org's OWN sections — Profile (overview), Team,
  // Integrations, Usage. Memories / Agents / Apps are top-level destinations
  // (sidebar nav in app/+layout.svelte), NOT org sub-pages: they live under
  // this route for org-scoped data loading but are absent from `tabs`, so they
  // render via {@render children()} WITHOUT the breadcrumb/tab-bar chrome.
  import { page } from '$app/stores';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}`);

  // Consumer-mode users only get the dashboard (Profile); their other sections
  // (Memories) live in the sidebar nav and the admin sub-routes redirect them
  // away anyway. Full-mode org sections: Profile, Team, Integrations, Usage.
  const tabs = $derived(
    data.isConsumerMode
      ? [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
        ]
      : [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
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
  // #364: the "Organization: <name>" caption + URN belong to the Profile tab
  // only. On every other tab the sub-route renders its own section heading
  // (Memories / Agents / Apps / …) as the page caption.
  const isProfile = $derived(activeTab?.id === 'profile');
</script>

<div class="space-y-4">
  {#if showChrome}
    <div class="mb-4">
      <!-- On sub-tabs the org H1 is gone, so link the org crumb back to Profile. -->
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        isProfile ? { label: data.org.name } : { label: data.org.name, href: basePath },
      ]} />
      {#if isProfile}
        <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
          <span class="font-normal text-zinc-400">{t('org-detail.prefix.organization', 'Organization:')}</span> {data.org.name}
        </h1>
        <Urn value={data.org.urn} type="org" />
      {/if}
    </div>

    {#if tabs.length > 1}
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
  {/if}

  {@render children()}
</div>
