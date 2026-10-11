<script lang="ts">
  // Shared usage-events grid (@tanstack/table-core + the Svelte 5 runes adapter,
  // src/lib/table/*). Used by the per-memory Usage tab (#266). The `listKey`
  // keeps each list's saved views distinct (e.g. 'memory:<id>:usage').
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import ViewTabs from '$lib/components/table/ViewTabs.svelte';
  import TableFrame from './TableFrame.svelte';
  import ColumnToggle from '$lib/components/table/ColumnToggle.svelte';
  import type { UsageEvent } from '$lib/components/table/usageEvent';

  let {
    events,
    listKey,
    maxHeight = 'calc(100vh - 23rem)',
  }: { events: UsageEvent[]; listKey: string; maxHeight?: string } = $props();

  // Epoch milliseconds (or null when absent/unparseable) so the Time column sorts
  // by instant rather than by the raw wire string. The `DateTime` scalar only
  // guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC — so a
  // pass-through value carrying a non-UTC offset makes lexicographic string order
  // differ from chronological order. See hadron-server
  // hrn:node:hadronmemory.com:hadron-server:conventions:datetime-scalar-for-date-fields.
  function dateMs(val: string | null): number | null {
    if (!val) return null;
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  }

  function formatDate(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let globalFilter = $state('');

  // Columns hold raw, sortable accessor values; display formatting is applied
  // at render time via `fmt` (keyed by column id) so numeric/date sort is kept.
  const columns: PortalColumnDef<UsageEvent>[] = [
    { accessorFn: (r) => dateMs(r.createdAt), id: 'createdAt', header: 'Time', enableHiding: false, size: 120 }, // identity column
    { accessorKey: 'type', header: 'Type', size: 100 },
    { accessorKey: 'nodeLoc', header: 'Node', size: 320 },
    { accessorKey: 'model', header: 'Model', size: 160 },
    { accessorFn: (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0), id: 'tokens', header: 'Tokens', size: 110 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    createdAt: (v) => formatDate(v as number | null),
    nodeLoc: (v) => (v as string | null) ?? '—',
    model: (v) => (v as string | null) ?? '—',
    tokens: (v) => ((v as number) > 0 ? (v as number).toLocaleString() : '—'),
  };

  const table = createSvelteTable<UsageEvent>({
    get data() {
      return events;
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
    // #820 — `createdAt` accessors epoch millis (sort by instant) and `tokens`
    // a summed number rendered with thousands separators, so 'includesString'
    // searched neither what the reader sees nor what they would paste. `fmt` is
    // the SAME map the cell falls back to; `extras` carries the wire ISO the
    // date accessor discarded.
    globalFilterFn: makeGlobalFilterFn<UsageEvent>(fmt, {
      createdAt: (row) => row.createdAt,
    }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  const pageSize = $derived(table.atoms.pagination.get().pageSize);
  const pageIndex = $derived(table.atoms.pagination.get().pageIndex);
  const pageCount = $derived(table.getPageCount());

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
</script>

<div class="space-y-4">
  {#if events.length === 0}
    <p class="text-sm text-zinc-500">No usage events found.</p>
  {:else}
    <TableFrame active={globalFilter.trim() !== ''}>
      {#snippet controls()}
      <input type="text" placeholder="Search events..." bind:value={globalFilter}
      class="min-w-[10rem] max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
        <ViewTabs {table} {listKey} bordered={false} class="min-w-[14rem] flex-1" />
        <ColumnToggle {table} />
      {/snippet}
    <!-- Bounded, internally-scrolling container; sticky header; footer stays
         visible below. -->
    <div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: {maxHeight};">
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
                    <button
                      type="button"
                      tabindex="-1"
                      aria-label="Resize column"
                      class="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none border-0 bg-transparent p-0 hover:bg-indigo-400 {header.column.getIsResizing() ? 'bg-indigo-500' : ''}"
                      onmousedown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      ontouchstart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      onclick={(e) => e.stopPropagation()}
                    ></button>
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
    </TableFrame>
  {/if}
</div>
