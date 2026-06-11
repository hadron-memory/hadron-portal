<script lang="ts">
  // Migrated off svelte-headless-table to @tanstack/table-core + the Svelte 5
  // runes adapter (src/lib/table/*). See docs/grid-bakeoff.md.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ViewTabs from '$lib/components/table/ViewTabs.svelte';
  import ColumnToggle from '$lib/components/table/ColumnToggle.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(val: string | null): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Raw elapsed milliseconds (or null) so the Duration column sorts numerically;
  // formatting happens in `fmt.duration` at render time.
  function durationMs(start: string | null, end: string | null): number | null {
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e) || e - s < 0) return null;
    return e - s;
  }

  function formatDuration(ms: number | null): string {
    if (ms == null) return '—';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3600_000).toFixed(1)}h`;
  }

  interface Session {
    id: string; type: string; appId: string | null; repo: string | null; branch: string | null;
    llmModel: string | null; summary: string | null; inputTokens: number | null; outputTokens: number | null;
    turnCount: number | null; errorCount: number | null; startedAt: string; endedAt: string | null;
  }

  let globalFilter = $state('');

  const columns: ColumnDef<Session>[] = [
    { accessorKey: 'startedAt', header: 'Started', enableHiding: false, size: 110 }, // identity column
    { accessorKey: 'type', header: 'Type', size: 90 },
    {
      accessorFn: (row) => row.summary ?? (row.repo ? `${row.repo}${row.branch ? ` (${row.branch})` : ''}` : '—'),
      id: 'summary',
      header: 'Summary',
      size: 320,
    },
    { accessorKey: 'llmModel', header: 'Model', size: 150 },
    { accessorFn: (row) => durationMs(row.startedAt, row.endedAt), id: 'duration', header: 'Duration', size: 90 },
    { accessorKey: 'turnCount', header: 'Turns', size: 70 },
    { accessorFn: (row) => (row.inputTokens ?? 0) + (row.outputTokens ?? 0), id: 'tokens', header: 'Tokens', size: 100 },
    { accessorKey: 'errorCount', header: 'Errors', size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    startedAt: (v) => formatDate(v as string | null),
    llmModel: (v) => (v as string | null) ?? '—',
    duration: (v) => formatDuration(v as number | null),
    turnCount: (v) => (v == null ? '—' : String(v)),
    tokens: (v) => ((v as number) > 0 ? (v as number).toLocaleString() : '—'),
    errorCount: (v) => (v == null ? '—' : String(v)),
  };

  const table = createSvelteTable<Session>({
    get data() {
      return data.sessions as Session[];
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

  const pageSize = $derived(table.getState().pagination.pageSize);
  const pageIndex = $derived(table.getState().pagination.pageIndex);
  const pageCount = $derived(table.getPageCount());

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
</script>

<svelte:head><title>Sessions · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Sessions' },
  ]} />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Sessions</h1>

  <!-- Saved-views tab strip -->
  <ViewTabs {table} listKey="usage:sessions" />

  <!-- Filter + columns -->
  <div class="flex items-center gap-4">
    <input type="text" placeholder="Search sessions..." bind:value={globalFilter}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    <ColumnToggle {table} />
  </div>

  {#if data.sessions.length === 0}
    <p class="text-sm text-zinc-500">No sessions found.</p>
  {:else}
    <!-- Bounded, internally-scrolling container so the page itself doesn't scroll
         and the pagination footer below stays visible. The `<thead>` is sticky so
         column headers remain while the body scrolls. (Tune the offset below.) -->
    <div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: calc(100vh - 23rem);">
      <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize()}px);">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {#each headerGroup.headers as header (header.id)}
                <th
                  class="sticky top-0 z-10 cursor-pointer select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200"
                  style="width: {header.getSize()}px;"
                  onclick={header.column.getToggleSortingHandler()}
                >
                  <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 truncate">{header.column.columnDef.header}</span>
                    <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>{sortIndicator(header.column.getIsSorted())}</span>
                  </div>
                  {#if header.column.getCanResize()}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-indigo-400 {header.column.getIsResizing() ? 'bg-indigo-500' : ''}"
                      onmousedown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      ontouchstart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      onclick={(e) => e.stopPropagation()}
                    ></div>
                  {/if}
                </th>
              {/each}
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each table.getRowModel().rows as row (row.id)}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              {#each row.getVisibleCells() as cell (cell.id)}
                {@const f = fmt[cell.column.id]}
                <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Footer: page size (left of Prev/Next) + pagination; always visible -->
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-zinc-500">{pageCount > 1 ? `Page ${pageIndex + 1} of ${pageCount}` : ''}</span>
      <div class="flex items-center gap-2">
        <select value={pageSize} onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
          aria-label="Rows per page"
          class="rounded-lg border border-zinc-300 !bg-zinc-100 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:!bg-zinc-800 dark:text-white">
          {#each [10, 20, 50, 100] as size}
            <option value={size}>{size} per page</option>
          {/each}
        </select>
        {#if pageCount > 1}
          <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</button>
          <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</button>
        {/if}
      </div>
    </div>
  {/if}
</div>
