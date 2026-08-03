<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  import type { MarketplaceRef } from './+page.server';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  const q = $derived(search.trim().toLowerCase());
  const matches = (r: MarketplaceRef) =>
    !q || r.name.toLowerCase().includes(q) || r.urn.toLowerCase().includes(q);
  const orgs = $derived(data.organizations.items.filter(matches));
  const agents = $derived(data.agents.items.filter(matches));
  const memories = $derived(data.memories.items.filter(matches));
  const anyResults = $derived(orgs.length + agents.length + memories.length > 0);
</script>

<svelte:head>
  <title>{t('marketplace.page.title', 'Browse Marketplace · Hadron')}</title>
</svelte:head>

{#snippet card(r: MarketplaceRef)}
  <div class="space-y-2">
    <p class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{r.name}</p>
    <p class="font-mono text-xs text-zinc-400 break-all">{r.urn}</p>
    {#if r.description}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{r.description}</p>
    {/if}
  </div>
{/snippet}

<div class="space-y-8">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('marketplace.page.heading', 'Browse Marketplace')}</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">{t('marketplace.page.description', 'Discover public organizations, agents, and knowledge memories.')}</p>
  </div>

  <div>
    <input
      type="text"
      placeholder={t('marketplace.search.placeholder', 'Search the marketplace...')}
      bind:value={search}
      class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
    />
  </div>

  {#if !anyResults}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      {search ? t('marketplace.empty.search', 'Nothing matches your search.') : t('marketplace.empty.catalogue', 'The marketplace is empty for now.')}
    </div>
  {/if}

  <!-- Organizations -->
  {#if orgs.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.organizations', 'Organizations')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.organizations.total})</span></h2>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each orgs as org (org.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(org)}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Agents -->
  {#if agents.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.agents', 'Agents')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.agents.total})</span></h2>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each agents as agent (agent.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(agent)}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Memories -->
  {#if memories.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.memories', 'Knowledge memories')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.memories.total})</span></h2>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each memories as memory (memory.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(memory)}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
