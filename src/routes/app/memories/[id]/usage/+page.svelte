<script lang="ts">
  // #266 Usage tab — per-memory usage events. Two representations of the same
  // activity behind a Table | Chart toggle (persisted, mirroring the Nodes
  // tab's Tree/Table pattern): the raw event rows, or the read/write time
  // series rendered by the shared UsageActivityChart. Chart data is fetched
  // client-side from ./usage/activity so the browser's time zone reaches the
  // server's day bucketing and window changes swap data without a reload.
  import UsageEventsTable from '$lib/components/table/UsageEventsTable.svelte';
  import UsageActivityChart from '$lib/components/UsageActivityChart.svelte';
  import type { UsageEvent } from '$lib/components/table/usageEvent';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const g = $derived(data.graph);

  // Table | Chart toggle, persisted like the Nodes tab's Tree/Table choice.
  // Seed a deterministic default for SSR, then hydrate the stored choice in an
  // effect — seeding $state from localStorage directly would diverge from the
  // server-rendered markup and trip a hydration mismatch.
  const PANE_KEY = 'hadron:memoryUsage:pane';
  const STYLE_KEY = 'hadron:memoryUsage:chartStyle';
  let pane = $state<'table' | 'chart'>('table');
  // Chart form: 'auto' keeps the density heuristic (bars ≤31 buckets, lines
  // beyond); an explicit choice pins the form across window changes.
  let chartStyle = $state<'auto' | 'bars' | 'lines'>('auto');
  let paneHydrated = false;
  $effect(() => {
    if (!paneHydrated) {
      paneHydrated = true;
      try {
        // The comparisons READ `pane`/`chartStyle`, registering them as
        // dependencies on this first run — without that the effect would never
        // re-run to persist later changes (same shape as MemoryBrowser's
        // Tree/Table toggle).
        const storedPane = window.localStorage.getItem(PANE_KEY) === 'chart' ? 'chart' : 'table';
        if (storedPane !== pane) pane = storedPane;
        const s = window.localStorage.getItem(STYLE_KEY);
        const storedStyle = s === 'bars' || s === 'lines' ? s : 'auto';
        if (storedStyle !== chartStyle) chartStyle = storedStyle;
      } catch {
        // Storage unavailable — keep the defaults.
      }
      return;
    }
    try {
      window.localStorage.setItem(PANE_KEY, pane);
      window.localStorage.setItem(STYLE_KEY, chartStyle);
    } catch {
      // Best-effort persistence only.
    }
  });

  // Chart data: lazily fetched per (memory, window) with the browser's zone.
  const WINDOW_OPTIONS = [7, 14, 30, 90];
  let windowDays = $state(30);
  interface Activity {
    windowDays: number;
    timeZone: string;
    buckets: Array<{ date: string; reads: number; writes: number }>;
    loadFailed: boolean;
  }
  let activity = $state<Activity | null>(null);
  let loading = $state(false);
  // One in-flight request wins: a stale response must not overwrite a newer
  // window's data.
  let fetchSeq = 0;
  async function loadActivity() {
    const seq = ++fetchSeq;
    loading = true;
    let tz = 'UTC';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      // Keep UTC.
    }
    try {
      const res = await fetch(
        `/app/memories/${g.id}/usage/activity?window=${windowDays}&tz=${encodeURIComponent(tz)}`,
      );
      if (seq !== fetchSeq) return;
      activity = res.ok ? ((await res.json()) as Activity) : null;
    } catch {
      if (seq === fetchSeq) activity = null;
    } finally {
      if (seq === fetchSeq) loading = false;
    }
  }
  // Fetch when the chart pane is (or becomes) active and the window changes;
  // reruns on windowDays because loadActivity reads it.
  $effect(() => {
    if (pane === 'chart') void loadActivity();
  });
</script>

<svelte:head><title>{g.name} &middot; Usage &middot; Hadron</title></svelte:head>

<section>
  <div class="mb-4 flex items-center justify-between gap-3">
    <h2 class="font-semibold text-zinc-900 dark:text-white">{t('usage.heading', 'Usage events')}</h2>
    <div class="flex items-center gap-3">
      {#if pane === 'chart'}
        <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" for="usage-style">
          {t('usage.style', 'Style')}
          <select
            id="usage-style"
            value={chartStyle}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              chartStyle = v === 'bars' || v === 'lines' ? v : 'auto';
            }}
            class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="auto">{t('usage.style-auto', 'Auto')}</option>
            <option value="bars">{t('usage.style-bars', 'Bars')}</option>
            <option value="lines">{t('usage.style-lines', 'Lines')}</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" for="usage-window">
          {t('usage.window', 'Window')}
          <select
            id="usage-window"
            bind:value={windowDays}
            class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {#each WINDOW_OPTIONS as d (d)}
              <option value={d}>{t('usage.window-days', '{n} days').replace('{n}', String(d))}</option>
            {/each}
          </select>
        </label>
      {/if}
      <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
        <button
          onclick={() => (pane = 'table')}
          class="px-2.5 py-1 text-xs {pane === 'table'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white'
            : 'text-zinc-500'}"
        >{t('usage.pane-table', 'Table')}</button>
        <button
          onclick={() => (pane = 'chart')}
          class="px-2.5 py-1 text-xs {pane === 'chart'
            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white'
            : 'text-zinc-500'}"
        >{t('usage.pane-chart', 'Chart')}</button>
      </div>
    </div>
  </div>

  {#if pane === 'table'}
    <UsageEventsTable events={data.events as UsageEvent[]} listKey="memory:{g.id}:usage" />
  {:else}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {#if activity?.loadFailed}
        <p role="alert" class="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('usage.chart-failed', "Couldn't load the activity chart just now — try again shortly.")}
        </p>
      {:else if !activity && loading}
        <p class="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('usage.chart-loading', 'Loading activity…')}
        </p>
      {:else if activity}
        <div class:opacity-60={loading}>
          <UsageActivityChart
            windowDays={activity.windowDays}
            buckets={activity.buckets}
            timeZone={activity.timeZone}
            {chartStyle}
          />
        </div>
      {/if}
    </div>
  {/if}
</section>
