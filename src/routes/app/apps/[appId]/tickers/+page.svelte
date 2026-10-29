<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import TickersNotParticipant from '$lib/components/tickers/TickersNotParticipant.svelte';
  import TickerSettingsPanel from '$lib/components/tickers/TickerSettingsPanel.svelte';
  import DeliverySettingsPanel from '$lib/components/tickers/DeliverySettingsPanel.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { cadenceText, isKnownReason, noVisibleChannelsText, noReasonsText, quietHoursSummary, reasonHelp, reasonLabel, reasonsSearchText, reasonsText, reasonsUnavailableText, relativeTime, tickerSearchText, tickerStateLabel, unrecognisedReasonText } from '$lib/tickers/format';
  import type { TickerListRow } from '$lib/tickers/types';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  /**
   * portal#1099 — the App's tickers (design §3.1), READ-ONLY: S7a (Holger via
   * Vera, team chat #11540). No Create, Edit, Subscribe or Delete control is
   * rendered; those are S7b and not in v1. The one write is the Delivery
   * section below the settings (portal#1141 slice A, hadron-server S9).
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const tickers = $derived(data.tickers);
  const liveCap = $derived(data.settings.kind === 'ok' ? data.settings.value.liveCap : null);
  // Relative times are computed against the load, so the page needs no polling;
  // the absolute time stays in each <time>'s title and datetime.
  const now = $derived(Date.parse(data.loadedAt));

  interface Row {
    ticker: TickerListRow;
    name: string;
    stateText: string;
    cadence: number;
    quiet: string;
    reasonsText: string;
    channelsText: string;
    subscriberCount: number;
    nextMs: number;
    lastMs: number;
    createdMs: number;
    ownerText: string;
  }

  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;
  const stateLabel = tickerStateLabel;
  // Anne's P2 on #1136: [] is also the server's answer when every named
  // channel is hidden from this reader, so it never reads as unrestricted.
  const channelsText = (tk: TickerListRow) =>
    tk.channels.length === 0 ? noVisibleChannelsText() : tk.channels.map((c) => c.name).join(', ');
  const subscribersText = (tk: TickerListRow) =>
    tk.subscribers.hasNextPage
      ? t('app.tickers.subscribers.more', '{n}+', { n: data.subscriberCountPage })
      : String(tk.subscribers.items.length);

  const rows = $derived<Row[]>(
    tickers.kind === 'ok'
      ? tickers.value.map((tk) => ({
          ticker: tk,
          // Search reaches what the row shows: name, URN, state, Mentions only (Anne's P3).
          name: tickerSearchText(tk),
          stateText: stateLabel(tk.enabled),
          cadence: tk.cadenceSeconds,
          quiet: quietHoursSummary(tk.quietHours),
          reasonsText: reasonsSearchText(tk.reasons),
          channelsText: channelsText(tk),
          subscriberCount: tk.subscribers.hasNextPage ? Number.MAX_SAFE_INTEGER : tk.subscribers.items.length,
          // A disabled ticker has no next tick; it sorts last, not first.
          nextMs: tk.nextTickAt ? ms(tk.nextTickAt) : Number.MAX_SAFE_INTEGER,
          lastMs: ms(tk.lastTickAt),
          createdMs: ms(tk.createdAt),
          ownerText: tk.owner?.name ?? '',
        }))
      : [],
  );

  let globalFilter = $state('');
  // §8: at 390px the grid keeps Ticker, State and Every on screen, so the first
  // three columns fit the 308px phone column together (140 + 84 + 76); the
  // name truncates and the rest scroll. Pinned in scripts/test-tickers-layout.mjs.
  const columns: PortalColumnDef<Row>[] = [
    { id: 'name', accessorFn: (r) => r.name, header: t('app.tickers.col.ticker', 'Ticker'), enableHiding: false, size: 140 },
    { id: 'state', accessorFn: (r) => r.stateText, header: t('app.tickers.col.state', 'State'), size: 84 },
    { id: 'cadence', accessorFn: (r) => r.cadence, header: t('app.tickers.col.every', 'Every'), size: 76 },
    { id: 'quiet', accessorFn: (r) => r.quiet, header: t('app.tickers.col.quiet', 'Quiet hours'), size: 240 },
    { id: 'reasons', accessorFn: (r) => r.reasonsText, header: t('app.tickers.col.reasons', 'Wakes when'), size: 200 },
    { id: 'channels', accessorFn: (r) => r.channelsText, header: t('app.tickers.col.counts', 'Counts'), size: 240 },
    { id: 'subscribers', accessorFn: (r) => r.subscriberCount, header: t('app.tickers.col.subscribers', 'Subscribers'), enableGlobalFilter: false, size: 120 },
    { id: 'next', accessorFn: (r) => r.nextMs, header: t('app.tickers.col.next', 'Next tick'), size: 150 },
    { id: 'owner', accessorFn: (r) => r.ownerText, header: t('app.tickers.col.owner', 'Owner'), size: 200 },
    { id: 'last', accessorFn: (r) => r.lastMs, header: t('app.tickers.col.last', 'Last tick'), size: 150 },
    { id: 'created', accessorFn: (r) => r.createdMs, header: t('app.tickers.col.created', 'Created'), size: 170 },
  ];
  const fmtCadence = (v: unknown) => (typeof v === 'number' ? cadenceText(v) : '');
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 && v < Number.MAX_SAFE_INTEGER ? fmtRunTime(String(v)) : '');
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    // Numbers sort as numbers but search by what the cell shows (#820).
    globalFilterFn: makeGlobalFilterFn<Row>({ cadence: fmtCadence, next: fmtMs, last: fmtMs, created: fmtMs }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'next', desc: false }],
      columnVisibility: { last: false, created: false },
    },
  });

  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }
</script>

<svelte:head><title>{t('app.tickers.head', 'Tickers')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.tickers.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tickers.crumb.tickers', 'Tickers') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('app.tickers.title.prefix', 'Tickers:')}</span> {data.app.name}
    </h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
      {t('app.tickers.intro', 'A ticker decides when the workers subscribed to it are due a wake-up. A router delivers the wake-ups; this page only shows who is due and when.')}
    </p>
  </div>

  {#if tickers.kind === 'not-participant'}
    <TickersNotParticipant impersonating={data.impersonating} />
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300" data-testid="ticker-count">
        {#if tickers.kind === 'ok'}
          {#if liveCap != null}
            {t('app.tickers.count', '{n} of {cap} tickers', { n: tickers.value.length, cap: liveCap })}
          {:else}
            {t('app.tickers.count-nocap', '{n} tickers', { n: tickers.value.length })}
          {/if}
        {/if}
      </p>
      <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{t('app.tickers.updated-at', 'Updated {time}', { time: fmtRunTime(data.loadedAt) })}</span>
        <button
          type="button"
          onclick={refresh}
          disabled={refreshing}
          class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('app.tickers.refresh', 'Refresh')}</button>
      </div>
    </div>

    {#if tickers.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tickers.load-failed', 'Couldn’t load tickers.')}
        <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
      </div>
    {:else if rows.length === 0}
      <!-- §7: the state everyone meets first. It must not claim a ticker wakes anyone today. -->
      <div role="status" class="space-y-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="tickers-empty">
        <p>
          <span class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.empty.lead', 'No tickers yet.')}</span>
          {t('app.tickers.empty.body', 'A mention already makes a worker due at once, unless its mentions are off or it is paused. A ticker adds scheduled wake-ups: every so often, it makes the workers subscribed to it that have unread messages due.')}
        </p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tickers.empty.router', 'A router delivers the wake-ups. This page only decides who is due and when.')}</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tickers.empty.create', 'Creating a ticker isn’t available in the portal yet; use the MCP tool hadron_ticker_create.')}</p>
      </div>
    {:else}
      <DataTable
        {table}
        listKey="app-tickers"
        searchPlaceholder={t('app.tickers.search', 'Search tickers…')}
        searchAriaLabel={t('app.tickers.search', 'Search tickers…')}
        bind:globalFilter
        maxHeight="max(240px, calc(100vh - 26rem))"
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'name'}
            <div class="flex min-w-0 flex-col">
              <a href="{basePath}/tickers/{row.ticker.id}" class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.ticker.name}</a>
              {#if row.ticker.urn}<Urn value={row.ticker.urn} size={9} compact linked label={t('app.tickers.urn-label', 'ticker')} />{/if}
            </div>
          {:else if cell.column.id === 'state'}
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium {row.ticker.enabled
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}"
            >{row.stateText}</span>
          {:else if cell.column.id === 'cadence'}
            <span class="whitespace-nowrap">{cadenceText(row.ticker.cadenceSeconds)}</span>
          {:else if cell.column.id === 'quiet'}
            <span class="block max-w-full truncate" title={row.quiet}>{row.quiet}</span>
          {:else if cell.column.id === 'reasons'}
            <span class="flex min-w-0 flex-wrap items-center gap-1">
              {#if reasonsText(row.ticker.reasons) === reasonsUnavailableText()}
                <span class="text-zinc-500 dark:text-zinc-400">{reasonsUnavailableText()}</span>
              {:else if row.ticker.reasons.length === 0}
                <span class="text-zinc-500 dark:text-zinc-400">{noReasonsText()}</span>
              {:else}
                {#each row.ticker.reasons as reason (reason)}
                  <span class="rounded px-1.5 py-0.5 text-xs {reason === 'EVERY_TICK'
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}" title={reasonHelp(reason) ?? undefined}>{reasonLabel(reason)}{#if !isKnownReason(reason)} <span class="text-zinc-600 dark:text-zinc-400">{unrecognisedReasonText()}</span>{/if}</span>
                {/each}
              {/if}
            </span>
          {:else if cell.column.id === 'channels'}
            <span class="flex min-w-0 flex-wrap items-center gap-1">
              <span class="block max-w-full truncate" title={row.channelsText}>{row.channelsText}</span>
              {#if row.ticker.relevance === 'MENTIONS'}
                <span class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t('app.tickers.relevance.mentions', 'Mentions only')}</span>
              {/if}
            </span>
          {:else if cell.column.id === 'subscribers'}
            <span>{subscribersText(row.ticker)}</span>
          {:else if cell.column.id === 'next' || cell.column.id === 'last'}
            {@const iso = cell.column.id === 'next' ? row.ticker.nextTickAt : row.ticker.lastTickAt}
            {#if iso}
              <time datetime={iso} title={fmtRunTime(iso)} class="whitespace-nowrap">{relativeTime(iso, now)}</time>
            {:else}
              <span class="text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'owner'}
            {#if row.ticker.owner}
              <div class="flex min-w-0 flex-col">
                <span class="truncate">{row.ticker.owner.name}</span>
                {#if row.ticker.owner.urn}<Urn value={row.ticker.owner.urn} size={9} compact linked />{/if}
              </div>
            {:else}
              <span class="text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'created'}
            <span class="whitespace-nowrap">{fmtRunTime(row.ticker.createdAt)}</span>
          {/if}
        {/snippet}
      </DataTable>
    {/if}

    <TickerSettingsPanel settings={data.settings} />
    <DeliverySettingsPanel appId={data.app.id} settings={data.delivery} impersonating={data.impersonating} />
  {/if}
</div>
