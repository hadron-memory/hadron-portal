<script lang="ts">
  // "App Runs" — every headless (LLM) run in the active org, across all its
  // apps. Same shape as the Task Nodes page: the shared DataTable chrome
  // (search + saved-views "+ view" + Columns on one row, sticky sortable/
  // resizable header, pagination footer) over a bounded window of rows, rather
  // than a bespoke table. The per-app audit list (/app/apps/[appId]/runs) stays
  // the drill-down; a row's Open link lands on that app's run detail page,
  // which owns the live view and the kill switch.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import {
    RUN_STATUSES,
    describeTrigger,
    entryNodeLabel,
    failureCode,
    fmtRunTime,
    parseApiDate,
    runDuration,
    statusChipClass,
    type AppRunStatus,
  } from '$lib/flow/runs';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);

  interface RunRow {
    id: string;
    appId: string;
    /** App name when the name lookup succeeded, else the raw id. */
    app: string;
    status: AppRunStatus;
    trigger: string;
    entry: string;
    entryUrn: string;
    /** Epoch millis (or null) so Started sorts chronologically, not as text. */
    startedMs: number | null;
    started: string;
    duration: string;
    /** Raw elapsed ms (or null) so Duration sorts numerically. */
    durationMs: number | null;
    failure: string;
    href: string;
  }

  const rows = $derived<RunRow[]>(
    data.runs.map((run) => {
      const startedRaw = run.startedAt ?? run.createdAt;
      const start = parseApiDate(run.startedAt);
      const end = parseApiDate(run.finishedAt);
      return {
        id: run.id,
        appId: run.appId,
        app: data.appNames[run.appId] ?? run.appId,
        status: run.status,
        trigger: describeTrigger(run),
        entry: entryNodeLabel(run.entryNodeUrn),
        entryUrn: run.entryNodeUrn,
        startedMs: parseApiDate(startedRaw)?.getTime() ?? null,
        started: fmtRunTime(startedRaw),
        duration: runDuration(run),
        durationMs: start && end && end.getTime() >= start.getTime() ? end.getTime() - start.getTime() : null,
        failure: failureCode(run) ?? '',
        href: `/app/apps/${run.appId}/runs/${run.id}`,
      };
    }),
  );

  let globalFilter = $state('');

  const columns: ColumnDef<RunRow>[] = [
    // Identity column: when it ran. Numeric accessor sorts chronologically;
    // `started` carries the rendered string for display and search.
    { accessorFn: (row) => row.startedMs, id: 'started', header: t('org-runs.column.started', 'Started'), enableHiding: false, size: 180 },
    {
      accessorKey: 'status',
      header: t('org-runs.column.status', 'Status'),
      size: 120,
      // Multi-select: the filter value is an ARRAY of statuses, so a view can
      // pin "not finished yet" (PENDING + RUNNING). None of TanStack's built-in
      // filterFns fit — `arrIncludesSome` expects the ROW value to be the array,
      // and ours is a scalar — so match membership the other way round. An
      // empty/absent selection means no filtering.
      filterFn: (row, columnId, value: AppRunStatus[]) =>
        !value?.length || value.includes(row.getValue(columnId) as AppRunStatus),
    },
    { accessorKey: 'app', header: t('org-runs.column.app', 'App'), size: 160 },
    { accessorKey: 'trigger', header: t('org-runs.column.trigger', 'Trigger'), size: 170 },
    { accessorKey: 'entry', header: t('org-runs.column.entry', 'Entry node'), size: 280 },
    { accessorFn: (row) => row.durationMs, id: 'duration', header: t('org-runs.column.duration', 'Duration'), size: 100 },
    { accessorKey: 'failure', header: t('org-runs.column.failure', 'Failure'), size: 200 },
    // Hiding the only way into a run's detail (and its kill switch) is a trap.
    { id: 'actions', header: t('org-runs.column.open', 'Open'), enableSorting: false, enableHiding: false, size: 90 },
  ];

  const table = createSvelteTable<RunRow>({
    get data() {
      return rows;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // ── Status filter ─────────────────────────────────────────────────────────
  // A COLUMN filter, not a server arg: `columnFilters` is one of the slices a
  // saved view persists, so "show me everything that hasn't finished yet"
  // (PENDING + RUNNING) becomes a named view. A server arg couldn't do that —
  // it lives in the URL, which views don't capture — and it only took ONE
  // status, so it couldn't express "unfinished" at all.
  const statusColumn = $derived(table.getColumn('status'));
  const selectedStatuses = $derived((statusColumn?.getFilterValue() as AppRunStatus[] | undefined) ?? []);

  function toggleStatus(status: AppRunStatus) {
    const next = selectedStatuses.includes(status)
      ? selectedStatuses.filter((s) => s !== status)
      : [...selectedStatuses, status];
    // Undefined (not []) clears the filter, so the column reports no active
    // filter rather than an empty-array one.
    statusColumn?.setFilterValue(next.length ? next : undefined);
  }

  /** Rows surviving every filter — drives the "nothing matches" state below. */
  const visibleRowCount = $derived(table.getFilteredRowModel().rows.length);
</script>

<svelte:head><title>App Runs · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">{t('org-runs.title', 'App Runs')}</h1>
    <p class="mt-1 text-sm text-zinc-500">
      {t('org-runs.description', 'Every headless run in this organization — what ran, why, and what happened. Open a run to watch it live or stop it.')}
    </p>
  </div>

  <!-- Multi-select status filter. Buttons, not links: this is a COLUMN filter,
       so the selection rides in `columnFilters` and a saved view captures it
       ("Unfinished" = PENDING + RUNNING). Toggles expose state via aria-pressed
       in a labelled group (review:segmented-control-aria-pressed). -->
  <div
    role="group"
    aria-label={t('org-runs.filter.aria-label', 'Filter runs by status')}
    class="flex flex-wrap items-center gap-1.5"
  >
    <button
      type="button"
      onclick={() => statusColumn?.setFilterValue(undefined)}
      aria-pressed={selectedStatuses.length === 0}
      class="rounded-full px-2.5 py-1 text-xs font-medium {selectedStatuses.length === 0
        ? 'bg-indigo-600 text-white'
        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
    >{t('org-runs.filter.all', 'All')}</button>
    {#each RUN_STATUSES as status (status)}
      <button
        type="button"
        onclick={() => toggleStatus(status)}
        aria-pressed={selectedStatuses.includes(status)}
        class="rounded-full px-2.5 py-1 text-xs font-medium {selectedStatuses.includes(status)
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
      >{status}</button>
    {/each}
    {#if selectedStatuses.length > 0}
      <span class="ml-1 text-xs text-zinc-500">
        {t('org-runs.filter.matching', '{n} matching').replace('{n}', String(visibleRowCount))}
      </span>
    {/if}
  </div>

  {#if data.failed}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {t('org-runs.failed', 'Couldn’t load runs — the run query failed. Try again shortly.')}
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {t('org-runs.empty.title', 'No runs yet.')}
      </p>
      <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
        {t(
          'org-runs.empty.explainer',
          'Runs start from a trigger: a schedule (run every morning), a webhook (run when an outside system calls), or manually — the “Test flow” button on any runnable node mints one.',
        )}
      </p>
    </div>
  {:else}
    {#if data.truncated}
      <p class="text-sm text-amber-600 dark:text-amber-400">
        {t('org-runs.truncated', 'Showing the {shown} most recent of {total} runs. Filters apply to these {shown}.')
          .replace(/\{shown\}/g, String(rows.length))
          .replace('{total}', String(data.total))}
      </p>
    {/if}

    <!-- Filters exclude every row. This is a BANNER above a still-mounted
         DataTable, not a branch that replaces it (Codex P1 on #680): DataTable
         owns ViewTabs, and ViewTabs re-runs `ctrl.init()` on mount, which
         re-applies the persisted active view. Swapping the table out for an
         empty state would therefore trap the user — "Clear filters" restores
         rows, the table remounts, init() re-applies the same zero-match view,
         and they're back here with no way to switch, edit or delete it.
         Keeping the chrome mounted also keeps the truncation line above
         visible, so a zero-match result still says only the newest N were
         searched (Codex P2). -->
    {#if visibleRowCount === 0}
      <div role="status" class="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
        <span class="font-medium text-zinc-600 dark:text-zinc-300">
          {data.truncated
            ? t('org-runs.empty.filtered-truncated', 'No runs match the current filters — and only the {shown} most recent runs were searched.').replace('{shown}', String(rows.length))
            : t('org-runs.empty.filtered', 'No runs match the current filters.')}
        </span>
        <button
          type="button"
          onclick={() => { statusColumn?.setFilterValue(undefined); globalFilter = ''; }}
          class="ml-2 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('org-runs.empty.clear-filters', 'Clear filters')}</button>
      </div>
    {/if}

    <DataTable
      {table}
      listKey="orgs:runs"
      searchPlaceholder={t('org-runs.search-placeholder', 'Search runs by app, trigger, or entry node…')}
      searchAriaLabel={t('org-runs.search.aria-label', 'Search runs')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 24rem))"
    >
      {#snippet cell(cell, run)}
        {#if cell.column.id === 'started'}
          <span class="whitespace-nowrap">{run.started}</span>
        {:else if cell.column.id === 'status'}
          <span class="rounded-full px-2 py-0.5 text-xs font-medium {statusChipClass(run.status)}">{run.status}</span>
        {:else if cell.column.id === 'app'}
          <a href="/app/apps/{run.appId}/runs" class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{run.app}</a>
        {:else if cell.column.id === 'entry'}
          <!-- The <Urn> chip alone: it already renders the loc, so the separate
               loc line above it was duplicate text in every row. The column
               still SORTS and SEARCHES on the loc via the `entry` accessor. -->
          <div class="min-w-0" title={run.entryUrn}><Urn value={run.entryUrn} type="node" size={8} /></div>
        {:else if cell.column.id === 'duration'}
          <span class="whitespace-nowrap">{run.duration}</span>
        {:else if cell.column.id === 'failure'}
          <span class="font-mono text-xs text-red-600 dark:text-red-400">{run.failure || '—'}</span>
        {:else if cell.column.id === 'actions'}
          <a href={run.href} class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t('org-runs.open', 'Open')}</a>
        {:else}
          {cell.getValue() ?? '—'}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
