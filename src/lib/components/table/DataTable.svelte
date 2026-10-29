<!--
  Shared chrome for the portal's TanStack grid pages (sessions, api-keys,
  org memories/agents/apps). Extracts the ~150 lines of identical markup
  each page previously copied: the ViewTabs strip, search + ColumnToggle
  row, the sticky-header sortable/resizable table, and the pagination
  footer.

  Pages keep what differs: column defs, fmt maps, the createSvelteTable
  call, empty states, and cell rendering — passed in via the `cell`
  snippet, which receives the TanStack cell plus `row.original` so pages
  can special-case by `cell.column.id` (name links, badges, <Urn>, action
  buttons/forms).

  Chrome conventions (Hadron: findings:portal-table-chrome-conventions):
  tableStrings pagination copy, keyboard-accessible sorting (tabindex /
  valid aria-sort tokens / Enter+Space), keyboard-accessible column
  resizing (role="separator", arrow keys), and a viewport-floored
  max-height whose rem offset is tuned per page via the `maxHeight` prop.
-->
<script lang="ts" generics="T extends RowData">
  import type { PortalCell, PortalTable } from '$lib/table/features';
  import type { RowData } from '@tanstack/table-core';
  import type { Snippet } from 'svelte';
  import ViewTabs from './ViewTabs.svelte';
  import ColumnToggle from './ColumnToggle.svelte';
  import TableFrame from './TableFrame.svelte';
  import { tableStrings } from '$lib/i18n/table-strings';

  let {
    table,
    listKey,
    searchPlaceholder,
    searchAriaLabel,
    globalFilter = $bindable(''),
    searchable = true,
    maxHeight = 'max(200px, calc(100vh - 23rem))',
    rowClass,
    rowAttrs,
    cell,
  }: {
    table: PortalTable<T>;
    listKey: string;
    searchPlaceholder: string;
    searchAriaLabel: string;
    globalFilter?: string;
    /** `false` drops the table's own search box, for a list whose search is the
     *  server's and lives outside the table (portal#1400): a second, local
     *  filter over loaded rows would hide matches the server found. */
    searchable?: boolean;
    /** Scroll-container max-height. The rem offset is tuned per page to
     *  its chrome height; keep the 200px floor (short-viewport guard). */
    maxHeight?: string;
    /** Extra classes for a body row (e.g. dim revoked rows). */
    rowClass?: (item: T) => string;
    /** Extra attributes for a body row (e.g. data-testid hooks). */
    rowAttrs?: (item: T) => Record<string, string | undefined>;
    /** Renders every cell's content; receives the TanStack cell and
     *  `row.original`. */
    cell: Snippet<[PortalCell<T, unknown>, T]>;
  } = $props();

  let headerOpen = $state(false);
  const active = $derived(globalFilter.trim() !== '');

  const pageSize = $derived(table.atoms.pagination.get().pageSize);
  const pageIndex = $derived(table.atoms.pagination.get().pageIndex);
  const pageCount = $derived(table.getPageCount());

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }

  // Keyboard resize step (px per arrow press). Mirrors the drag handler's
  // effect via setColumnSizing; 40px floor keeps a column grabbable.
  const RESIZE_STEP = 10;
  function resizeByKeyboard(e: KeyboardEvent, columnId: string, size: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = Math.max(40, size + (e.key === 'ArrowLeft' ? -RESIZE_STEP : RESIZE_STEP));
    table.setColumnSizing((old) => ({ ...old, [columnId]: next }));
  }
</script>

<!-- #1021: search, saved views and Columns are the table's header — folded by
     default behind one toggle, attached to the table's top edge when open (see
     TableFrame). The view strip takes the remaining width (flex-1) so its
     "+ New view" button lands next to Columns; bordered=false since it no
     longer sits on its own line. -->
<TableFrame {active} {searchable} bind:open={headerOpen}>
  {#snippet controls()}
  {#if searchable}
  <input type="text" placeholder={searchPlaceholder} aria-label={searchAriaLabel} bind:value={globalFilter}
      class="min-w-[10rem] max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
  {/if}
  <ViewTabs {table} {listKey} bordered={false} class="min-w-[14rem] flex-1" />
  <ColumnToggle {table} />
  {/snippet}

<!-- Bounded, internally-scrolling container so the page itself doesn't
     scroll and the pagination footer below stays visible. The `<thead>`
     is sticky so column headers remain while the body scrolls. -->
<div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: {maxHeight};">
  <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize()}px);">
    <thead>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {#each headerGroup.headers as header (header.id)}
            <th
              class="sticky top-0 z-10 select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900 {header.column.getCanSort() ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : ''}"
              style="width: {header.getSize()}px;"
              tabindex={header.column.getCanSort() ? 0 : undefined}
              aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}
              onclick={header.column.getToggleSortingHandler()}
              onkeydown={(e) => {
                if (header.column.getCanSort() && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  header.column.getToggleSortingHandler()?.(e);
                }
              }}
            >
              <div class="flex min-w-0 items-center gap-1">
                <span class="min-w-0 truncate">{header.column.columnDef.header}</span>
                {#if header.column.getCanSort()}
                  <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>{sortIndicator(header.column.getIsSorted())}</span>
                {/if}
              </div>
              {#if header.column.getCanResize()}
                <!-- A focusable separator is the canonical ARIA "window
                     splitter" widget (role=separator + tabindex + arrow
                     keys); Svelte's linter doesn't model it and flags the
                     tabindex/handlers as noninteractive. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-indigo-400 focus:bg-indigo-400 focus:outline-none {header.column.getIsResizing() ? 'bg-indigo-500' : ''}"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={tableStrings.resizeColumn()}
                  aria-valuenow={header.getSize()}
                  aria-valuemin={40}
                  tabindex={0}
                  onmousedown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                  ontouchstart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => { e.stopPropagation(); resizeByKeyboard(e, header.column.id, header.getSize()); }}
                ></div>
              {/if}
            </th>
          {/each}
        </tr>
      {/each}
    </thead>
    <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
      {#each table.getRowModel().rows as row (row.id)}
        <tr
          class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 {rowClass ? rowClass(row.original) : ''}"
          {...rowAttrs ? rowAttrs(row.original) : {}}
        >
          {#each row.getVisibleCells() as c (c.id)}
            <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {@render cell(c, row.original)}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
</TableFrame>

<!-- Footer: page size (left of Prev/Next) + pagination; always visible.
     Both rows wrap (#1270): the select is sized by its longest option label
     and cannot shrink beside Previous/Next, so a no-wrap footer pushed the
     document 14px wide on a 390px phone. Wrapping keeps every control in
     flow and reachable instead. -->
<div data-testid="table-footer" class="flex flex-wrap items-center justify-between gap-3">
  <span class="text-sm text-zinc-500">{pageCount > 1 ? tableStrings.pageOf(pageIndex + 1, pageCount) : ''}</span>
  <div class="flex flex-wrap items-center gap-2">
    <select value={pageSize} onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
      aria-label={tableStrings.rowsPerPage()}
      class="rounded-lg border border-zinc-300 !bg-zinc-100 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:!bg-zinc-800 dark:text-white">
      {#each [10, 20, 50, 100] as size}
        <option value={size}>{tableStrings.perPage(size)}</option>
      {/each}
    </select>
    {#if pageCount > 1}
      <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.previous()}</button>
      <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.next()}</button>
    {/if}
  </div>
</div>
