<script lang="ts">
  import PublicResourceTable from '$lib/components/PublicResourceTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const organization = $derived(data.organization);
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

  <!-- Reset both grids' search and page state when SvelteKit reuses this page
       for a different organization. Org-scoped listKeys also prevent a saved
       default filter from one organization hiding rows in another. -->
  {#key organization.id}
    <section aria-labelledby="public-memories-heading" class="space-y-3">
      <h2 id="public-memories-heading" class="text-xl font-semibold text-zinc-900 dark:text-white">
        {t('public-organization.memories.heading', 'Public memories ({count})', { count: organization.publicMemories.length })}
      </h2>
      <PublicResourceTable
        resources={organization.publicMemories}
        kind="memory"
        listKey="public-organization:memories:{organization.id}"
      />
    </section>

    <section aria-labelledby="public-agents-heading" class="space-y-3">
      <h2 id="public-agents-heading" class="text-xl font-semibold text-zinc-900 dark:text-white">
        {t('public-organization.agents.heading', 'Public agents ({count})', { count: organization.publicAgents.length })}
      </h2>
      <PublicResourceTable
        resources={organization.publicAgents}
        kind="agent"
        listKey="public-organization:agents:{organization.id}"
      />
    </section>
  {/key}
</div>
