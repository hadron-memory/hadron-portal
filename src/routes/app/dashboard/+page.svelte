<script lang="ts">
  // #629: the stats page for every user. Simple stats for now (memory count +
  // preview + quick actions); org-scoped stats and activity charts are a
  // deliberate follow-up. The loader sends a bounded count + preview, so the
  // page never receives the full memory set.
  import DashboardGrid from '$lib/dashboard/DashboardGrid.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const memoryCount = $derived(data.memoryCount ?? 0);
  const preview = $derived(data.preview ?? []);
  const loadFailed = $derived(data.loadFailed === true);

  // #636: layout + per-widget data come from the server (dashboardWidgets +
  // dashboardWidgetData), with a default layout when the user hasn't customized.
  const placements = $derived(data.placements ?? []);
  const widgetData = $derived(data.widgetData ?? {});
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
  <div class="flex items-center justify-between gap-4">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
      {#if displayName}
        {t('dashboard.heading-named', 'Welcome back, {name}').replace('{name}', displayName)}
      {:else}
        {t('dashboard.heading', 'Dashboard')}
      {/if}
    </h1>
    <a
      href="/app/dashboard/customize"
      class="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-indigo-700"
    >
      {t('dashboard.customize.link', 'Customize')}
    </a>
  </div>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('dashboard.load-failed', "Couldn't load your stats just now — this is a temporary error. Try refreshing the page.")}
    </div>
  {:else}
    <!-- Widget grid (#636). Only rendered when the load succeeded (the alert
         branch above handles failure), so widgets don't need a loadFailed prop. -->
    <DashboardGrid {placements} {widgetData} />

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
