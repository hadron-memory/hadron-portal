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
  resizing (role="separator", arrow keys), and a scroll area that sizes
  itself: it fills from its own top edge to the bottom of the window (less
  the footer), so no page tunes an offset (portal#2193, ruling 0276). A list
  inside a dialog, picker or detail section passes `bounded` instead.
-->
<script lang="ts" generics="T extends RowData">
  import type { PortalCell, PortalTable } from '$lib/table/features';
  import type { RowData } from '@tanstack/table-core';
  import { onMount, type Snippet } from 'svelte';
  import ViewTabs from './ViewTabs.svelte';
  import ColumnToggle from './ColumnToggle.svelte';
  import TableFrame from './TableFrame.svelte';
  import { tableStrings } from '$lib/i18n/table-strings';
  import { fillHeight, measureBelow } from '$lib/fill-viewport';

  let {
    table,
    listKey,
    searchPlaceholder,
    searchAriaLabel,
    globalFilter = $bindable(''),
    headerOpen = $bindable(false),
    showSearch = true,
    showFooter = true,
    showPageSize = true,
    initialColumnsOnly = false,
    sortButtons = false,
    bounded = false,
    fitOnPhone = false,
    phoneHiddenColumns = [],
    containCells = false,
    stickyEndColumn,
    rowClass,
    rowAttrs,
    cell,
  }: {
    table: PortalTable<T>;
    listKey: string;
    searchPlaceholder: string;
    searchAriaLabel: string;
    globalFilter?: string;
    /** Callers may reveal the existing filter before a guarded focus handoff. */
    headerOpen?: boolean;
    /** Server-filtered callers supply their own search control. */
    showSearch?: boolean;
    /** Server-paged callers (a page of a larger list) draw their own Previous/Next and total. */
    showFooter?: boolean;
    showPageSize?: boolean;
    initialColumnsOnly?: boolean;
    sortButtons?: boolean;
    /** A list inside a dialog, picker or detail section: the scroll area keeps one fixed
     *  height (BOUNDED_MAX_HEIGHT) instead of filling the window. Full-page lists leave it off. */
    bounded?: boolean;
    /** Fit a SINGLE-column table and its header to the scroller on phones; desktop saved widths stay live. */
    fitOnPhone?: boolean;
    /** Column ids hidden below `sm` by CSS only (no JS visibility, so no hydration flash and
     *  saved widths/order stay untouched). Ignored while no other column would stay visible on
     *  the phone, so a table never goes blank. Never name `stickyEndColumn` here. The caller must
     *  show the same information elsewhere on the phone, e.g. folded into another cell. With
     *  `fitOnPhone`, the count of columns still visible on the phone decides the single-column fit. */
    phoneHiddenColumns?: string[];
    /** Opt-in cell boundary repair; callers must also adapt their cell content. */
    containCells?: boolean;
    /** Keep one row-action column reachable on phones, independent of saved order. */
    stickyEndColumn?: string;
    /** Extra classes for a body row (e.g. dim revoked rows). Must not
     * replace the row's opaque background: the phone sticky cell inherits
     * it, and a see-through row would show scrolled columns under the
     * pinned actions cell. */
    rowClass?: (item: T) => string;
    /** Extra attributes for a body row (e.g. data-testid hooks). */
    rowAttrs?: (item: T) => Record<string, string | undefined>;
    /** Renders every cell's content; receives the TanStack cell and
     *  `row.original`. */
    cell: Snippet<[PortalCell<T, unknown>, T]>;
  } = $props();

  const active = $derived(globalFilter.trim() !== '');

  /** The one bounded height, with the short-window floor. */
  const BOUNDED_MAX_HEIGHT = 'max(200px, 40vh)';
  let scrollerEl = $state<HTMLElement>();
  let footerEl = $state<HTMLElement>();
  /** Filled height in px; null until measured (server render, first paint), when CSS stands in. */
  let fillPx = $state<number | null>(null);
  // Measured like the node page's editors (#878): the window's height, less where the scroller
  // starts on the page, less the footer under it and the gutter the app shell leaves.
  function measureFill() {
    if (bounded || !scrollerEl) return;
    const next = fillHeight({ viewportHeight: window.innerHeight, top: scrollerEl.getBoundingClientRect().top + window.scrollY, below: measureBelow(scrollerEl, footerEl) });
    if (next !== fillPx) fillPx = next;
  }
  onMount(() => {
    measureFill();
    // The header above can change height (a banner, wrapped filters, tabs) and the window can be
    // resized: re-measure on either, so no page needs to guess.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measureFill);
    observer?.observe(document.body);
    window.addEventListener('resize', measureFill);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measureFill); };
  });
  const scrollerMaxHeight = $derived(bounded ? BOUNDED_MAX_HEIGHT : fillPx !== null ? `${fillPx}px` : 'max(200px, calc(100vh - 23rem))');

  /** Phone width (px) a sticky end column is clamped to below the `sm`
   * breakpoint — the one source for both the header width and the table-width
   * subtraction (#1954; was a repeated 170 literal in each). */
  const PHONE_END_COLUMN_PX = 170;

  // Widths ship as custom properties and the breakpoint picks in CSS. The
  // server render has no viewport, so a JS-decided phone width (matchMedia in
  // an effect, state starting false) necessarily painted desktop widths first
  // and corrected at hydration — a visible flash on exactly the phones the
  // clamp exists for. CSS evaluates before first paint and needs no listener.
  // The phone-hidden set only applies while at least one OTHER column stays visible there: a
  // viewer can hide the sole kept column (Columns toggle) or restore a saved view that does, and
  // a phone table with every cell display:none is blank (#1991 local review).
  const phoneHidden = $derived(table.getVisibleLeafColumns().some(column => !phoneHiddenColumns.includes(column.id)) ? phoneHiddenColumns : []);
  const singleColumnFit = $derived(fitOnPhone && table.getVisibleLeafColumns().filter(column => !phoneHidden.includes(column.id)).length === 1);
  const endColumn = $derived(stickyEndColumn
    ? table.getVisibleLeafColumns().find(column => column.id === stickyEndColumn)
    : undefined);
  const desktopTableWidth = $derived(`max(100%, ${table.getCenterTotalSize()}px)`);
  // A restored wide desktop action column must not cover the phone viewport.
  // Adjust table AND header together; keep the stored TanStack size untouched.
  // The subtraction is clamped at zero: a restored size below the clamp (a
  // stale or hand-edited saved view applies columnSizing raw, with no
  // minSize floor) would otherwise go negative and WIDEN the phone table
  // past the desktop total while the header still clamps to 170.
  const phoneTableWidth = $derived(singleColumnFit
    ? '100%'
    : `max(100%, ${table.getCenterTotalSize() - (endColumn ? Math.max(endColumn.getSize(), PHONE_END_COLUMN_PX) - PHONE_END_COLUMN_PX : 0)}px)`);
  // The RENDERED phone width stays a flat 170 floor — min(size, 170) was
  // considered and declined in the #1973 review: the sticky column exists to
  // keep row actions reachable on the phone INDEPENDENT of saved state
  // (#1950 pinned this; scripts/test-table-cell-overflow-layout.mjs asserts
  // it), and only a raw hand-edited saved view can restore below the floor.
  // The cost is that such a pathological view renders the phone table up to
  // (170 − size) wider than the desktop total under table-fixed — accepted.
  const phoneEndColumnWidth = $derived(endColumn ? PHONE_END_COLUMN_PX : undefined);

  const pageSize = $derived(table.atoms.pagination.get().pageSize);
  const pageIndex = $derived(table.atoms.pagination.get().pageIndex);
  const pageCount = $derived(table.getPageCount());

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }

  // Keyboard resize step (px per arrow press). Mirrors the drag handler's
  // effect via setColumnSizing; retain the legacy40px floor unless the
  // consumer declares a larger minimum for its interactive content.
  const RESIZE_STEP = 10;
  function resizeByKeyboard(e: KeyboardEvent, columnId: string, size: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const minimum = Math.max(40, table.getColumn(columnId)?.columnDef.minSize ?? 40);
    const next = Math.max(minimum, size + (e.key === 'ArrowLeft' ? -RESIZE_STEP : RESIZE_STEP));
    table.setColumnSizing((old) => ({ ...old, [columnId]: next }));
  }
</script>

<!-- #1021: search, saved views and Columns are the table's header — folded by
     default behind one toggle, attached to the table's top edge when open (see
     TableFrame). The view strip takes the remaining width (flex-1) so its
     "+ New view" button lands next to Columns; bordered=false since it no
     longer sits on its own line. -->
<TableFrame {active} {showSearch} bind:open={headerOpen}>
  {#snippet controls()}
{#if showSearch}
<input type="text" placeholder={searchPlaceholder} aria-label={searchAriaLabel} bind:value={globalFilter}
    class="min-w-[10rem] max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
  {/if}
  <ViewTabs {table} {listKey} {initialColumnsOnly} bordered={false} class="min-w-[14rem] flex-1" />
  <ColumnToggle {table} />
  {/snippet}

<!-- Bounded, internally-scrolling container so the page itself doesn't
     scroll and the pagination footer below stays visible. The `<thead>`
     is sticky so column headers remain while the body scrolls. -->
<div bind:this={scrollerEl} data-testid="data-table-scroller" class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: {scrollerMaxHeight};">
  <table class="table-fixed w-[var(--table-desktop-w)] max-sm:w-[var(--phone-table-w)] text-sm" style="--table-desktop-w: {desktopTableWidth}; --phone-table-w: {phoneTableWidth};{phoneEndColumnWidth !== undefined ? ` --phone-end-w: ${phoneEndColumnWidth}px;` : ''}">
    <thead>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {#each headerGroup.headers as header (header.id)}
            <th
              class="sticky top-0 z-10 select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900 w-[var(--col-w)] {header.column.getCanSort() && !sortButtons ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : ''} {header.column.id === stickyEndColumn ? 'max-sm:left-0 max-sm:right-0 max-sm:z-20' : ''}{endColumn?.id === header.column.id && !singleColumnFit ? ' max-sm:w-[var(--phone-end-w)]' : ''}{singleColumnFit ? ' max-sm:w-full' : ''}{phoneHidden.includes(header.column.id) ? ' max-sm:hidden' : ''}{singleColumnFit ? ' max-sm:border-r-0' : ''}"
              style="--col-w: {header.getSize()}px;"
              tabindex={!sortButtons && header.column.getCanSort() ? 0 : undefined}
              aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}
              onclick={sortButtons ? undefined : header.column.getToggleSortingHandler()}
              onkeydown={(e) => {
                if (!sortButtons && header.column.getCanSort() && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  header.column.getToggleSortingHandler()?.(e);
                }
              }}
            >
              <div class="flex min-w-0 items-center gap-1">
                {#if sortButtons && header.column.getCanSort()}
                  <button type="button" class="min-h-11 min-w-0 cursor-pointer truncate text-left hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-zinc-200" onclick={header.column.getToggleSortingHandler()}>{header.column.columnDef.header}</button>
                {:else}<span class="min-w-0 truncate">{header.column.columnDef.header}</span>{/if}
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
                  class="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-indigo-400 focus:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-300 {singleColumnFit || header.column.id === endColumn?.id ? 'max-sm:hidden ' : ''}{header.column.getIsResizing() ? 'bg-indigo-500' : ''}"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={tableStrings.resizeColumn()}
                  aria-valuenow={header.getSize()}
                  aria-valuemin={Math.max(40, header.column.columnDef.minSize ?? 40)}
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
        <!-- The base background below is a load-bearing invariant, not
             decoration: the phone sticky cell inherits it (max-sm:bg-inherit),
             so a row without an opaque background would let scrolled columns
             show through the pinned actions cell. rowClass may add classes
             (dimming), never replace this background. -->
        <tr
          class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900 {rowClass ? rowClass(row.original) : ''}"
          {...rowAttrs ? rowAttrs(row.original) : {}}
        >
          {#each row.getVisibleCells() as c (c.id)}
            <td data-cell-contained={containCells ? '' : undefined} class="{containCells ? 'overflow-hidden [overflow-wrap:anywhere]' : ''} border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 {phoneHidden.includes(c.column.id) ? 'max-sm:hidden ' : ''}{singleColumnFit ? 'max-sm:border-r-0 ' : ''}{c.column.id === stickyEndColumn ? 'max-sm:sticky max-sm:left-0 max-sm:right-0 max-sm:z-[1] max-sm:bg-inherit max-sm:focus-within:z-30 max-sm:has-[[data-menu-open]]:z-30' : ''}">
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
{#if showFooter}
<div bind:this={footerEl} data-testid="table-footer" class="mt-3 flex flex-wrap items-center justify-between gap-3">
  <span aria-current={pageCount > 1 ? 'page' : undefined} class="text-sm text-zinc-500">{pageCount > 1 ? tableStrings.pageOf(pageIndex + 1, pageCount) : ''}</span>
  <div class="flex flex-wrap items-center gap-2">
    {#if showPageSize}<select value={pageSize} onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
      aria-label={tableStrings.rowsPerPage()}
      class="rounded-lg border border-zinc-300 !bg-zinc-100 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:!bg-zinc-800 dark:text-white">
      {#each [10, 20, 50, 100] as size}
        <option value={size}>{tableStrings.perPage(size)}</option>
      {/each}
    </select>{/if}
    {#if pageCount > 1}
      <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.previous()}</button>
      <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.next()}</button>
    {/if}
  </div>
</div>
{/if}
