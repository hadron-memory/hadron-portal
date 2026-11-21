<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import StopBanner from '$lib/components/stops/StopBanner.svelte';
  import StopSignalsPanel from '$lib/components/stops/StopSignalsPanel.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { actorText, canLiftStops, levelLabel, scopeLabel, stateLabel, stopState, targetOf } from '$lib/stop-signals/present';
  import type { StopSignal } from '$lib/stop-signals/types';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  import LiveRegion from '$lib/components/LiveRegion.svelte';

  /**
   * portal#1139 — the App's stop signals. A stop signal has no URN and none is
   * shown: a row carries its plain id. A target worker shows its URN when the
   * roster names it; an id the roster doesn't know is shown bare.
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const signals = $derived<StopSignal[]>(data.page.kind === 'ok' ? data.page.value.signals : []);
  let lifting = $state<{ id: string; label: string } | null>(null);

  interface Row {
    s: StopSignal;
    state: string;
    level: string;
    scope: string;
    target: string;
    setBy: string;
    setAtMs: number;
    untilMs: number;
  }
  const ms = (v: string | null) => parseApiDate(v)?.getTime() ?? 0;
  const rows = $derived<Row[]>(
    signals.map((s) => ({
      s,
      state: stateLabel(stopState(s)),
      level: levelLabel(s.level),
      scope: scopeLabel(s.scope),
      target: targetOf(s, data.workers)?.name ?? targetOf(s, data.workers)?.id ?? '',
      setBy: actorText(s.setByUserId, s.setByHostKey, data.people),
      setAtMs: ms(s.setAt),
      untilMs: ms(s.until),
    })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { id: 'state', accessorFn: (r) => r.state, header: t('app.stops.col.state', 'State'), enableHiding: false, size: 110 },
    { id: 'level', accessorFn: (r) => r.level, header: t('app.stops.col.level', 'Level'), size: 130 },
    { id: 'target', accessorFn: (r) => `${r.scope} ${r.target}`, header: t('app.stops.col.target', 'Target'), size: 240 },
    { id: 'setBy', accessorFn: (r) => r.setBy, header: t('app.stops.col.set-by', 'Set by'), size: 180 },
    { id: 'setAt', accessorFn: (r) => r.setAtMs, header: t('app.stops.col.set-at', 'Set'), enableGlobalFilter: false, size: 160 },
    { id: 'until', accessorFn: (r) => r.untilMs, header: t('app.stops.col.until', 'Until'), enableGlobalFilter: false, size: 160 },
    { id: 'ended', accessorFn: (r) => r.s.endedAt ?? '', header: t('app.stops.col.ended', 'Ended'), enableGlobalFilter: false, size: 200 },
    { id: 'id', accessorFn: (r) => r.s.id, header: t('app.stops.col.id', 'Id'), size: 200 },
    { id: 'actions', accessorFn: () => '', header: t('app.stops.col.actions', 'Actions'), enableSorting: false, enableHiding: false, enableGlobalFilter: false, size: 100 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({}),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'setAt', desc: true }],
      columnVisibility: { id: false },
    },
  });

  const canLift = $derived(canLiftStops(data.impersonating, data.manages));
  function liftLabel(s: StopSignal): string {
    const target = targetOf(s, data.workers);
    return `${levelLabel(s.level)} · ${scopeLabel(s.scope)}${target ? ` · ${target.name ?? target.id}` : ''}`;
  }

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

<svelte:head><title>{t('app.stops.head', 'Stops')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.stops.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.stops.crumb.stops', 'Stops') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('app.stops.title.prefix', 'Stops:')}</span> {data.app.name}
    </h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
      {t('app.stops.intro', 'A stop keeps a worker or a team from being given work or woken, by level. Several stops can cover the same worker; each applies on its own and lifting one never ends another.')}
    </p>
  </div>

  <LiveRegion>
    {#if data.page.kind === 'not-participant'}
      <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
        {t('app.stops.not-participant', 'You’re not a participant in this App, so its stops aren’t shown.')}
      </div>
    {/if}
  </LiveRegion>
  {#if data.page.kind === 'not-participant'}
    <!-- announced by the region above -->
  {:else}
    <StopBanner live={data.live} workers={data.workers} />

    <StopSignalsPanel
      appId={data.app.id}
      manages={data.manages}
      workers={data.workers}
      rosterFailed={data.rosterFailed}
      impersonating={data.impersonating}
      {lifting}
      onliftclose={() => (lifting = null)}
    />

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{t('app.stops.updated-at', 'Updated {time}', { time: fmtRunTime(data.loadedAt) })}</span>
      <button type="button" onclick={refresh} disabled={refreshing} class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        {t('app.stops.refresh', 'Refresh')}
      </button>
    </div>

    {#if data.page.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.stops.load-failed', 'Couldn’t load the stops.')}
        <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.stops.retry', 'Try again')}</button>
      </div>
    {:else if rows.length === 0}
      <div role="status" class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="stops-empty">
        {#if data.after}
          {t('app.stops.empty-older', 'No older stops.')}
          <a href="?" class="ml-2 font-medium text-indigo-600 underline dark:text-indigo-300">{t('app.stops.first-page', 'Back to the first stops')}</a>
        {:else}
          {t('app.stops.empty', 'No stops have been set on this App.')}
        {/if}
      </div>
    {:else}
      <DataTable
        {table}
        listKey="app-stop-signals"
        searchPlaceholder={t('app.stops.search', 'Search stops…')}
        searchAriaLabel={t('app.stops.search', 'Search stops…')}
        bind:globalFilter
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'state'}
            <span class="rounded-full px-2 py-0.5 text-xs font-medium {row.s.live ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}">{row.state}</span>
          {:else if cell.column.id === 'level'}
            <span>{row.level}</span>
          {:else if cell.column.id === 'target'}
            {@const target = targetOf(row.s, data.workers)}
            <div class="flex min-w-0 flex-col">
              <span class="truncate">{row.scope}{#if target}{' · '}{target.name ?? target.id}{/if}</span>
              {#if target?.urn}<Urn value={target.urn} type="worker" size={9} compact linked label={t('app.stops.target-label', 'target worker')} />{/if}
            </div>
          {:else if cell.column.id === 'setBy'}
            <span class="truncate">{row.setBy}</span>
          {:else if cell.column.id === 'setAt'}
            <time datetime={row.s.setAt} class="whitespace-nowrap">{fmtRunTime(row.s.setAt)}</time>
          {:else if cell.column.id === 'until'}
            {#if row.s.until}<time datetime={row.s.until} class="whitespace-nowrap">{fmtRunTime(row.s.until)}</time>{:else}<span class="text-zinc-500">{t('app.stops.until-lifted', 'until lifted')}</span>{/if}
          {:else if cell.column.id === 'ended'}
            {#if row.s.endedAt}
              <span class="whitespace-nowrap">{row.s.endKind === 'EXPIRED' ? t('app.stops.ended.expired', 'Expired') : t('app.stops.ended.lifted', 'Lifted')} {fmtRunTime(row.s.endedAt)}{#if row.s.endKind === 'LIFTED'}{' · '}{actorText(row.s.endedByUserId, row.s.endedByHostKey, data.people)}{/if}</span>
            {:else}<span class="text-zinc-400">—</span>{/if}
          {:else if cell.column.id === 'id'}
            <code class="select-all font-mono text-xs">{row.s.id}</code>
          {:else if cell.column.id === 'actions'}
            {#if row.s.live && canLift}
              <button type="button" onclick={() => (lifting = { id: row.s.id, label: liftLabel(row.s) })} class="min-h-11 min-w-11 rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                {t('app.stops.lift', 'Lift')}
              </button>
            {/if}
          {/if}
        {/snippet}
      </DataTable>
      {#if data.page.kind === 'ok' && data.page.value.pageInfo.hasNextPage && data.page.value.pageInfo.endCursor}
        <a href="?after={encodeURIComponent(data.page.value.pageInfo.endCursor)}" class="inline-block text-sm font-medium text-indigo-600 underline dark:text-indigo-300">{t('app.stops.next-page', 'Show older stops')}</a>
      {/if}
      {#if data.after}<a href="?" class="ml-3 inline-block text-sm font-medium text-indigo-600 underline dark:text-indigo-300">{t('app.stops.first-page', 'Back to the first stops')}</a>{/if}
    {/if}
  {/if}
</div>
