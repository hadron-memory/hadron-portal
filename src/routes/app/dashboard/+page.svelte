<script lang="ts">
  // #629: individual-user dashboard. Org members never reach this — the loader
  // 302s them to their org overview. Simple stats for now (memory count +
  // preview + quick actions); activity charts / read-write rates are a
  // deliberate follow-up.
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const memories = $derived(data.memories ?? []);
  const memoryCount = $derived(memories.length);
  const loadFailed = $derived(data.loadFailed === true);
  const preview = $derived(memories.slice(0, 5));
  // The /app layout merges `user` into page data.
  const displayName = $derived(
    (data as { user?: { name?: string | null; handle?: string | null } }).user?.name ??
      ((data as { user?: { handle?: string | null } }).user?.handle
        ? `@${(data as { user?: { handle?: string | null } }).user!.handle}`
        : null),
  );
</script>

<svelte:head><title>{t('dashboard.title', 'Dashboard — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6 py-6">
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
    {#if displayName}
      {t('dashboard.heading-named', 'Welcome back, {name}').replace('{name}', displayName)}
    {:else}
      {t('dashboard.heading', 'Dashboard')}
    {/if}
  </h1>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('dashboard.load-failed', "Couldn't load your stats just now — this is a temporary error. Try refreshing the page.")}
    </div>
  {:else}
    <!-- Stat cards -->
    <div class="grid gap-4 sm:grid-cols-2">
      <a href="/app/memories" class="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700">
        <p class="text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">{memoryCount}</p>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {memoryCount === 1 ? t('dashboard.stat.memories-one', 'memory') : t('dashboard.stat.memories', 'memories')}
        </p>
      </a>
      <div class="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-zinc-200 p-5 dark:border-zinc-800">
        <a href="/app/memories/new" class="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">{t('dashboard.action.new-memory', '+ New memory')}</a>
      </div>
    </div>

    <!-- Memories preview -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('dashboard.memories.heading', 'Your memories')}</h2>
        {#if memoryCount > preview.length}
          <a href="/app/memories" class="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">{t('dashboard.memories.view-all', 'View all')} &rarr;</a>
        {/if}
      </div>
      {#if preview.length === 0}
        <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('dashboard.memories.empty', 'No memories yet — create your first one to get started.')}</p>
          <a href="/app/memories/new" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('dashboard.memories.empty-cta', 'Create a memory')}</a>
        </div>
      {:else}
        <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {#each preview as m (m.id)}
            <li class="bg-white px-4 py-3 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
              <a href="/app/memories/{m.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
              <div class="mt-0.5"><Urn value={m.urn} type="memory" size={10} /></div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
