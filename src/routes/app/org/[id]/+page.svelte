<script lang="ts">
  import PublicResourceTable from '$lib/components/PublicResourceTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { nextOffset, pageHref, previousOffset } from './paging';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const organization = $derived(data.organization);
  const memoriesNext = $derived(nextOffset(data.paging.memories.offset, organization.publicMemoriesPage));
  const memoriesPrevious = $derived(previousOffset(data.paging.memories.offset, data.paging.memories.limit));
  const agentsNext = $derived(nextOffset(data.paging.agents.offset, organization.publicAgentsPage));
  const agentsPrevious = $derived(previousOffset(data.paging.agents.offset, data.paging.agents.limit));

  function href(kind: 'memories' | 'agents', offset: number): string {
    return pageHref(data.path, data.search, kind, { limit: data.paging[kind].limit, offset });
  }
</script>

<svelte:head>
  <title>{t('public-organization.title', '{name} — Hadron', { name: organization.name })}</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 py-6">
  <header class="min-w-0">
    <h1 class="break-words text-2xl font-bold text-zinc-900 dark:text-white">{organization.name}</h1>
    <div class="mt-1 flex min-w-0">
      <Urn value={organization.urn} type="org" label={organization.name} />
    </div>
    {#if organization.listedOnMarketplace}
      <span class="mt-3 inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
        {t('public-organization.marketplace.listed', 'Listed in the marketplace')}
      </span>
    {/if}
  </header>

  <!-- Keyed organization state prevents a late A response from leaving A's
       rows or saved views under B. Native GET links make the URL the only page
       navigation writer; SvelteKit's normal load invalidation handles Retry. -->
  {#key organization.id}
    <section aria-labelledby="public-memories-heading" class="space-y-3">
      <h2 id="public-memories-heading" class="text-xl font-semibold text-zinc-900 dark:text-white">
        {t('public-organization.memories.heading', 'Public memories ({count})', { count: organization.publicMemoriesPage.total })}
      </h2>
      <PublicResourceTable
        page={organization.publicMemoriesPage}
        offset={data.paging.memories.offset}
        prevHref={memoriesPrevious === null ? null : href('memories', memoriesPrevious)}
        nextHref={memoriesNext === null ? null : href('memories', memoriesNext)}
        firstHref={data.paging.memories.offset > 0 ? href('memories', 0) : null}
        kind="memory"
        listKey="public-organization:memories:{organization.id}"
      />
    </section>

    <section aria-labelledby="public-agents-heading" class="space-y-3">
      <h2 id="public-agents-heading" class="text-xl font-semibold text-zinc-900 dark:text-white">
        {t('public-organization.agents.heading', 'Public agents ({count})', { count: organization.publicAgentsPage.total })}
      </h2>
      <PublicResourceTable
        page={organization.publicAgentsPage}
        offset={data.paging.agents.offset}
        prevHref={agentsPrevious === null ? null : href('agents', agentsPrevious)}
        nextHref={agentsNext === null ? null : href('agents', agentsNext)}
        firstHref={data.paging.agents.offset > 0 ? href('agents', 0) : null}
        kind="agent"
        listKey="public-organization:agents:{organization.id}"
      />
    </section>
  {/key}
</div>
