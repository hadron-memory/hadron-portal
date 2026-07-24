<script lang="ts">
  // "My memories" — the caller's own (org-less, user-owned) memories. Shown to
  // EVERYONE via the "My memories" nav item; org members have their org grid
  // separately, but their personal memories live here.
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const memories = $derived(data.memories ?? []);
  const loadFailed = $derived(data.loadFailed === true);
</script>

<svelte:head><title>{t('my-memories.title', 'My memories — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-memories.heading', 'My memories')}</h1>
    <a
      href="/app/memories/new"
      class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >{t('my-memories.new', 'New memory')}</a>
  </div>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('my-memories.load-failed', "Couldn't load your memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
    </div>
  {:else if memories.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p class="text-sm text-zinc-600 dark:text-zinc-400">
        {t('my-memories.empty', "You don't have any memories yet.")}
      </p>
      <a
        href="/app/memories/new"
        class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >{t('my-memories.empty-cta', 'Create your first memory')}</a>
    </div>
  {:else}
    <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {#each memories as m (m.id)}
        <li class="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
          <div class="min-w-0">
            <a href="/app/memories/{m.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
            <div class="mt-0.5"><Urn value={m.urn} type="memory" size={10} /></div>
          </div>
          {#if m.class === 'private'}
            <span class="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t('my-memories.badge.private', 'Private')}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
