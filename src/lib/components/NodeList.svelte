<script lang="ts">
  // Migrated off svelte-headless-table (Svelte-4, dormant) to @tanstack/table-core
  // + our Svelte 5 runes adapter. First production consumer of src/lib/table/*.
  // Public API (props) is unchanged so both call sites — MemoryBrowser (browse
  // list) and the node-detail Children tab (orderable) — keep working.
  import { commentHitView, openFeedbackCue } from '$lib/comments';
  import { onMount, untrack } from 'svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { SavedView } from '$lib/table/savedView';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import Urn from './Urn.svelte';
  import NodeEmbeddingBadges from './NodeEmbeddingBadges.svelte';
  import { nodeListHref } from '$lib/node-list-links';
  import ViewTabs from './table/ViewTabs.svelte';
  import TableFrame from './table/TableFrame.svelte';
  import ColumnToggle from './table/ColumnToggle.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { approvedCellText, changedByView, signedCellText, type NodeColumnRow } from '$lib/node-columns';
  import { t } from '$lib/i18n/t';
  import type { MemoryNode, SearchHitMeta } from '$lib/types';

  let {
    nodes,
    basePath = '',
    memoryUrn = '',
    orderable = false,
    onreorder,
    listKey,
    hideSearch = false,
    viewMemoryId = '',
    snippets = {},
    meta = {},
    deletedIds = [],
    showColumns = false,
    embeddingEnabled = false,
    columnData = {},
    columnsLoading = 0,
    columnsFailed = 0,
    signingOffered = true,
    onretrycolumns,
    onvisiblenodes,
    serverPaged = false,
    serverView,
    emptyMessage = 'No nodes.',
  }: {
    nodes: MemoryNode[];
    /** portal#2705: the owner's server-run search, as the two slices a saved view can hold. */
    serverView?: { get: () => Pick<SavedView, 'sorting' | 'columnFilters'>; apply: (view: SavedView, options?: { initial?: boolean }) => void };
    /** Text for an empty list; '' when the owner already says it. */
    emptyMessage?: string;
    basePath?: string;
    memoryUrn?: string;
    orderable?: boolean;
    onreorder?: (orderedLocs: string[]) => void;
    /** When set (and not orderable), renders the saved-views picker. */
    listKey?: string;
    /** Hide the built-in search box (the owner provides search — issue #355). */
    hideSearch?: boolean;
    /** The memory this list is shown for: a row from another memory is marked inherited. */
    viewMemoryId?: string;
    /**
     * #430: nodeId → best matching-passage snippet, from a semantic search.
     * When present for a row, rendered under the node name. Empty in browse.
     */
    snippets?: Record<string, string>;
    /**
     * #432: nodeId → per-hit relevance + vector metadata from a search. Renders
     * a relevance % and a stale-abstract badge on the row. Empty in browse.
     */
    meta?: Record<string, SearchHitMeta>;
    /** #1161: ids the SERVER reports as deleted (recoveryNodes); rows outside it carry no mark. */
    deletedIds?: string[];
    /**
     * portal#1174: add Role, Last changed, Changed by, Revision, Approved and
     * Signed. Off by default so the children list and every other consumer keep
     * their three columns. Fixed at mount, like the rest of the column set.
     */
    showColumns?: boolean;
    /**
     * portal#1346: the browsed memory is vector-indexed, so a row may carry the
     * pending/failed embedding badge from its (lazily loaded) columns.
     */
    embeddingEnabled?: boolean;
    /** nodeId → that node's extra columns, as they load. A node absent here has not loaded. */
    columnData?: Record<string, NodeColumnRow>;
    /** How many nodes' columns are still being read. */
    columnsLoading?: number;
    /** How many nodes' columns could not be read. */
    columnsFailed?: number;
    /** False when the deployment has signing off: the Signed column then says so rather than staying blank. */
    signingOffered?: boolean;
    onretrycolumns?: () => void;
    /**
     * portal#1174: the ids of the rows on screen now (the current page after
     * sort, filter and paging), so the owner reads the extra columns for those
     * rows only and never for the whole memory.
     */
    onvisiblenodes?: (ids: string[]) => void;
    /** The owner fetched and ordered this complete window; its pager is the only one. */
    serverPaged?: boolean;
  } = $props();
  const deletedSet = $derived(new Set(deletedIds));

  // portal#1174: the extra columns are read from `columnData` at render time,
  // NOT merged into the table's data. Rebuilding the data array whenever a page's
  // columns land would change its identity, and TanStack resets the page index
  // when the data reference changes, bouncing the reader back to page 1
  // (Gemma on #1181). The columns are not sortable or filterable, so nothing in
  // the row model needs them.
  const colsOf = (n: MemoryNode): NodeColumnRow | undefined => (showColumns ? columnData[n.id] : undefined);
  const instantMs = (v: string | null | undefined): number | null => {
    if (!v) return null;
    const ms = new Date(v).getTime();
    return Number.isNaN(ms) ? null : ms;
  };

  // #432: relevance tooltip — explain the relative % and add the vector "why did
  // this match" lineage when the hit came from the vector index.
  function relevanceTitle(m: SearchHitMeta): string {
    const lines = [t('node-list.relevance-of-top', 'Relevance, relative to the top hit')];
    if (m.similarity !== null)
      lines.push(`${t('node-list.similarity', 'similarity')} ${(m.similarity * 100).toFixed(0)}%`);
    if (m.model) lines.push(`${t('node-list.model', 'model')} ${m.model}`);
    if (m.source) lines.push(`${t('node-list.source', 'source')} ${m.source}`);
    return lines.join(' · ');
  }

  function nodeUrn(node: MemoryNode): string {
    // The node's own authorized identity survives a withheld Memory record.
    if (node.urn) return node.urn;
    // Older/slim reads may not select it; preserve their existing fallback.
    const u = memoryUrn || node.memory?.urn || '';
    return u && node.loc ? composeNodeUrn(u, node.loc) : node.loc;
  }

  // ── Page size (#275) ────────────────────────────────────────────────────
  const PAGE_SIZE_KEY = 'hadron:nodeList:pageSize';
  const PAGE_SIZES = [10, 25, 100];
  const DEFAULT_PAGE_SIZE = 25;

  // Global filter (search across the visible columns), held in runes state.
  // One condition for the saved-views strip and for the header toggle's label, so they cannot drift.
  const hasViews = $derived(!orderable && !!listKey);
  let globalFilter = $state('');
  const tableCanSortAndResize = untrack(() => !orderable);

  // Everything a comment row renders, so the table filter finds it (per hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable).
  function commentSearchText(n: MemoryNode): string {
    const c = n.comment!;
    const v = commentHitView(c);
    return [
      n.name, v.role, c.deleted ? 'deleted' : '',
      v.author.label, v.author.urn ?? '', v.author.agent?.label ?? '', v.author.agent?.urn ?? '',
      c.target.name, c.target.urn, v.anchor.text,
    ].join(' ');
  }

  // portal#1174: these columns are read for the displayed page only, so a sort
  // or a text filter over them would be over the pages that happen to have
  // loaded, not over the memory, and must not pretend otherwise. The server
  // filters (approval, minted) and sorts (updatedAt) stay the whole-memory way
  // to ask those questions.
  const PAGE_ONLY = { enableSorting: false, enableGlobalFilter: false } as const;

  const columns: PortalColumnDef<MemoryNode>[] = [
    {
      // portal#1015: a comment hit's row also renders its author and target, so
      // the table filter searches them too (per hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable).
      // A content row's accessor is still its name.
      id: 'name',
      accessorFn: (n) => (n.comment ? commentSearchText(n) : n.name),
      header: 'Node',
      enableHiding: false,
      size: 280,
    }, // identity column — always shown
    { accessorKey: 'nodeType', header: 'Type', size: 120 },
    { accessorFn: (n) => n.description ?? '', id: 'description', header: 'Description', size: 400 },
    ...(untrack(() => showColumns)
      ? ([
          { ...PAGE_ONLY, accessorFn: (n) => colsOf(n)?.role ?? '', id: 'role', header: t('node-list.col.role', 'Role'), size: 140 },
          // Sorts by instant, not by the wire string (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant).
          { ...PAGE_ONLY, accessorFn: (n) => instantMs(colsOf(n)?.updatedAt), id: 'updatedAt', header: t('node-list.col.last-changed', 'Last changed'), size: 180 },
          { ...PAGE_ONLY, accessorFn: (n) => changedByView(colsOf(n)).searchText, id: 'changedBy', header: t('node-list.col.changed-by', 'Changed by'), size: 220 },
          { ...PAGE_ONLY, accessorFn: (n) => colsOf(n)?.revision ?? null, id: 'revision', header: t('node-list.col.revision', 'Revision'), size: 100 },
          { ...PAGE_ONLY, accessorFn: (n) => approvedCellText(colsOf(n)), id: 'approved', header: t('node-list.col.approved', 'Approved'), size: 200 },
          { ...PAGE_ONLY, accessorFn: (n) => signedCellText(colsOf(n)), id: 'signed', header: t('node-list.col.signed', 'Signed'), size: 180 },
        ] as PortalColumnDef<MemoryNode>[])
      : []),
  ];

  const table = createSvelteTable<MemoryNode>({
    get data() {
      return nodes;
    },
    columns,
    // A server-owned window is already paged, sorted and filtered. TanStack
    // must not add a second, page-local implementation of any of them.
    get manualPagination() { return serverPaged; },
    get manualSorting() { return serverPaged; },
    get manualFiltering() { return serverPaged; },
    enableMultiSort: false,
    // In the orderable (children) list, manual drag order is the source of
    // truth — sorting would fight it, so it's disabled there (PR #277 review).
    get enableSorting() { return tableCanSortAndResize && !serverPaged; },
    // Resizing only in the browse list; the orderable children list uses a drag
    // handle and a narrow, fixed column set.
    enableColumnResizing: tableCanSortAndResize,
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
    // Start at the default on both server and client; a stored preference is
    // applied after mount (below) to avoid an SSR hydration mismatch.
    initialState: { pagination: { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE } },
    // A stable object of closures (never a spread), so the owner's live criteria are read at call time.
    // Only a list whose owner runs the search declares a server view: for every other list the
    // table's own sorting and filters are the view (savedView.extractTableView / applyView).
    meta: untrack(() => serverView)
      ? {
          getServerView: () => serverView!.get(),
          applyServerView: (v: SavedView, o?: { initial?: boolean }) => serverView!.apply(v, o),
        }
      : {},
  });

  onMount(() => {
    // Seed the legacy standalone page-size. When saved views are enabled, the
    // ViewTabs' init() is async (awaits storage), so it resumes AFTER this
    // synchronous seed and overrides the page size from the active view if one
    // exists — and leaves this seed in place when no view is active (spec D7).
    try {
      if (serverPaged) return;
      const v = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
      if (PAGE_SIZES.includes(v)) table.setPageSize(v);
    } catch {
      /* ignore disabled storage */
    }
  });

  function changePageSize(size: number) {
    table.setPageSize(size);
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  // Orderable and server-paged lists show every supplied row so drag indices
  // and the outer server window stay stable; only a client-owned browse list pages.
  const displayRows = $derived(
    orderable || serverPaged ? table.getPrePaginatedRowModel().rows : table.getRowModel().rows,
  );
  // portal#1174: tell the owner which rows are on screen so it reads their
  // extra columns, and only theirs. Reads displayRows alone; the owner's
  // `ensure` skips ids it already asked about, so a late-arriving column that
  // rebuilds the rows does not ask again.
  $effect(() => {
    if (!showColumns || !onvisiblenodes) return;
    const ids = displayRows.map((r) => r.original.id);
    untrack(() => onvisiblenodes(ids));
  });
  const pageSize = $derived(table.atoms.pagination.get().pageSize);
  const pageIndex = $derived(table.atoms.pagination.get().pageIndex);
  const pageCount = $derived(table.getPageCount());

  // ── Drag-and-drop reordering ──────────────────────────────────────────
  // Track by node id, not row index: rows may be filtered/sorted, but the
  // reorder splices the original `nodes` array, so indices must be resolved
  // against `nodes` by id (PR #276 review — gemini-code-assist).
  let dragId = $state<string | null>(null);
  let dropId = $state<string | null>(null);

  function handleDragStart(e: DragEvent, id: string) {
    if (!orderable || !onreorder) return;
    dragId = id;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, id: string) {
    if (dragId === null || dragId === id) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropId = id;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    if (dragId === null || dropId === null || !onreorder) {
      resetDrag();
      return;
    }
    const from = nodes.findIndex((n) => n.id === dragId);
    const to = nodes.findIndex((n) => n.id === dropId);
    if (from === -1 || to === -1) {
      resetDrag();
      return;
    }
    const ordered = [...nodes];
    const [moved] = ordered.splice(from, 1);
    // The drop row is highlighted with a top border (insert *before* it). After
    // removing `from`, everything past it shifts left by one, so a downward move
    // must insert at `to - 1` to land above the drop target (PR #277 review).
    const insertAt = from < to ? to - 1 : to;
    ordered.splice(insertAt, 0, moved);
    onreorder(ordered.map((n) => n.loc));
    resetDrag();
  }

  function resetDrag() {
    dragId = null;
    dropId = null;
  }

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
</script>

<div class="space-y-3">
  <!-- #1021: search, saved views and Columns are this table's header — folded by
       default, attached to the table when open (TableFrame). ViewTabs takes the
       remaining width (flex-1) so its "+ New view" button lands next to Columns.
       An orderable list with no search has no controls, so no frame either. -->
  {#snippet tableBody()}
  {#if nodes.length === 0}
    {#if emptyMessage}<p class="text-sm text-zinc-500">{emptyMessage}</p>{/if}
  {:else}
    {#if showColumns}
      <p class="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        {t('node-list.last-changed-explanation', 'Last changed is when the node was last updated. Revisions show when snapshots were saved; these times can differ.')}
      </p>
      <!-- portal#1174: the extra columns arrive after the list; say so, and say when a batch failed, rather than leaving blanks unexplained. Always mounted so a screen reader announces a change. -->
      <p role="status" data-testid="node-columns-status" class="mb-2 min-h-4 text-xs text-zinc-500 dark:text-zinc-400">
        {#if columnsLoading > 0}{t('node-list.columns-loading', 'Loading details…')}{/if}
        {#if columnsFailed > 0}
          {t('node-list.columns-failed', "Details for {n} nodes couldn't be loaded.", { n: columnsFailed })}
          {#if onretrycolumns}<button type="button" class="ml-1 font-medium text-indigo-600 hover:underline dark:text-indigo-300" onclick={onretrycolumns}>{t('node-list.columns-retry', 'Retry')}</button>{/if}
        {/if}
      </p>
    {/if}
    <!-- Browse list scrolls inside a bounded container; the orderable children
         list keeps its natural height. Height = the area available to NodeList
         minus this list's own controls/footer chrome (the `10rem`).
         - In MemoryBrowser, that area is `--memory-browser-h`.
         - Standalone (e.g. the node-detail Children tab), there's no var, so the
           fallback IS the area available to NodeList: `100vh - 14rem` (page
           chrome above the ViewTabs/search rows). The shared `- 10rem` then
           reserves NodeList's own chrome, landing the table at ~`100vh - 24rem`.
           Subtracting the full 24rem here would double-count that chrome and
           leave the table ~10rem short of the viewport (#371). -->
    <div
      class="rounded-lg border border-zinc-200 dark:border-zinc-800 {orderable ? 'overflow-x-auto' : 'overflow-auto'}"
      style={orderable ? '' : 'max-height: calc(var(--memory-browser-h, calc(100vh - 14rem)) - 10rem);'}
    >
      <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize() + (orderable ? 32 : 0)}px);">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {#if orderable}<th class="sticky top-0 z-10 w-8 border-b border-r border-zinc-200 bg-zinc-50 px-2 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"></th>{/if}
              {#each headerGroup.headers as header (header.id)}
                <th
                  class="sticky top-0 z-10 select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900 {header.column.getCanSort() ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : ''}"
                  style="width: {header.getSize()}px;"
                  onclick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 truncate">{header.column.columnDef.header}</span>
                    {#if header.column.getCanSort()}
                      <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>
                        {sortIndicator(header.column.getIsSorted())}
                      </span>
                    {/if}
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
          {#each displayRows as row (row.id)}
            {@const n = row.original}
            {@const c = colsOf(n)}
            {@const hit = n.comment ? commentHitView(n.comment) : null}
            {@const href = nodeListHref(n, basePath)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <tr
              class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900
                {dropId === n.id && dragId !== null ? 'border-t-2 border-indigo-500' : ''}"
              draggable={orderable && onreorder ? 'true' : undefined}
              ondragstart={(e) => handleDragStart(e, n.id)}
              ondragover={(e) => handleDragOver(e, n.id)}
              ondragleave={() => { dropId = null; }}
              ondrop={handleDrop}
              ondragend={resetDrag}
            >
              {#if orderable}
                <td class="w-8 cursor-grab select-none border-r border-zinc-200 px-2 py-2.5 text-zinc-400 dark:border-zinc-800" title="Drag to reorder">⠿</td>
              {/if}
              {#each row.getVisibleCells() as cell (cell.id)}
                {#if cell.column.id === 'name'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span class="min-w-0 truncate">
                        {#if href}
                          <a {href} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{n.name}</a>
                        {:else}
                          <span class="font-medium text-zinc-900 dark:text-white">{n.name}</span>
                        {/if}
                        {#if n.seq !== null && n.seq !== undefined}
                          <span class="ml-1 text-xs tabular-nums text-zinc-400">#{n.seq}</span>
                        {/if}
                      </span>
                      {#if viewMemoryId && n.memoryId && n.memoryId !== viewMemoryId}
                        <span data-testid="node-inherited" class="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t('nodes-tab.inherited', 'inherited')}</span>
                      {/if}
                      {#if deletedSet.has(n.id)}
                        <span data-testid="node-deleted" class="shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{t('node.deleted.badge', 'Deleted')}</span>
                      {/if}
                      {#if meta?.[n.id]?.scorePct !== null && meta?.[n.id]?.scorePct !== undefined}
                        <!-- #432: relevance relative to the top hit (scores aren't
                             comparable across modes, so % of top, not the raw score). -->
                        <span
                          title={relevanceTitle(meta[n.id])}
                          class="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                        >{meta[n.id].scorePct}%</span>
                      {/if}
                      {#if (n.openThreads ?? 0) > 0}
                        <!-- portal#1014: the open-feedback cue in node lists, never a gate
                             (hrn:node:hadronmemory.com:specs:cor:dmo:110:07). -->
                        {@const cue = openFeedbackCue({ openThreads: n.openThreads ?? 0, resolvedThreads: 0, comments: 0 })}
                        {#if href}
                          <a
                            href={`${href}${href.includes('?') ? '&' : '?'}tab=discussion`}
                            data-testid="node-open-feedback"
                            class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
                          >{cue}</a>
                        {:else}
                          <!-- No node link here (local review on #1025, P3): the cue stays, as plain text. -->
                          <span data-testid="node-open-feedback" class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{cue}</span>
                        {/if}
                      {/if}
                      {#if meta?.[n.id]?.abstractStale}
                        <!-- #432: the abstract/preview may not match the node's
                             content (spec 032). Vector-index hits only.

                             #810 / hadron-server#1128 — ONE marker, TWO causes,
                             and the copy must assert neither:

                               - the fingerprint DISAGREES: the abstract was
                                 checked at author time and the content moved;
                               - the fingerprint is ABSENT on a node that has
                                 both an abstract and content: never checked.

                             Two wordings have now been wrong here, each by
                             naming one cause as the cause. "The abstract lags
                             the node content" is false for never-checked; "has
                             not been checked against it" — my own replacement —
                             is false for disagrees, and both bots caught it.
                             The form that no third counterexample can break is
                             to enumerate both and exclude neither, which is the
                             remedy #764 arrived at after seven rounds
                             (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee). -->
                        <span
                          title={t('node-list.abstract-stale', 'Preview may not match the node content — the abstract was written against different content, or was never checked against it')}
                          class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        >{t('node-list.stale-badge', 'preview may be stale')}</span>
                      {/if}
                    </div>
                    <div class="mt-0.5 truncate"><Urn value={nodeUrn(n)} type="node" size={8} /></div>
                    {#if c?.embedding}
                      <NodeEmbeddingBadges enabled={embeddingEnabled} pendingAt={c.embedding.pendingAt} failedAt={c.embedding.failedAt} error={c.embedding.error} />
                    {/if}
                    {#if hit && n.comment}
                      <!-- portal#1015: feedback, never content of its target: its author, the
                           node it concerns, and the revision it was written against
                           (hrn:node:hadronmemory.com:specs:cor:dmo:110:08). -->
                      <div data-testid="comment-hit" class="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{t('node-list.comment-label', 'Comment')} · {hit.role}</span>
                          {#if n.comment.deleted}
                            <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t('node-list.comment-deleted', 'deleted')}</span>
                          {/if}
                          <span data-testid="comment-hit-author">{t('node-list.comment-by', 'by {author}', { author: hit.author.label })}</span>
                          {#if hit.author.urn}<Urn value={hit.author.urn} size={8} />{/if}
                          {#if hit.author.agent}<span>{t('node-list.comment-via', 'via {agent}', { agent: hit.author.agent.label })}</span>{#if hit.author.agent.urn}<Urn value={hit.author.agent.urn} size={8} />{/if}{/if}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span>{t('node-list.comment-on', 'on')} <span data-testid="comment-hit-target" class="font-medium">{n.comment.target.name}</span></span>
                          <Urn value={n.comment.target.urn} type="node" size={8} />
                        </div>
                        <div data-testid="comment-hit-anchor" class={hit.anchor.current ? '' : 'text-amber-700 dark:text-amber-400'}>{hit.anchor.text}</div>
                      </div>
                    {/if}
                    {#if snippets?.[n.id]}
                      <!-- #430: best matching passage from a semantic search. -->
                      <div
                        title={t('node-list.best-matching-passage', 'Best matching passage (semantic search)')}
                        class="mt-1 line-clamp-2 rounded border-l-2 border-indigo-300 bg-indigo-50/60 px-2 py-1 text-xs italic text-zinc-600 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-zinc-400"
                      >…{snippets[n.id]}…</div>
                    {/if}
                  </td>
                {:else if cell.column.id === 'role'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    {#if c?.role}<span class="break-words font-mono text-xs text-zinc-700 dark:text-zinc-300">{c.role}</span>{:else if c}<span class="text-zinc-400">—</span>{/if}
                  </td>
                {:else if cell.column.id === 'updatedAt'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    {#if instantMs(c?.updatedAt) !== null}{new Date(c!.updatedAt!).toLocaleString()}{:else if c}<span class="text-zinc-400">—</span>{/if}
                  </td>
                {:else if cell.column.id === 'changedBy'}
                  {@const by = changedByView(c)}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs dark:border-zinc-800">
                    {#if by.user}
                      <div data-testid="changed-by-user" class="min-w-0">
                        <div class="truncate text-zinc-700 dark:text-zinc-300">{by.user.handle ? `@${by.user.handle}` : t('node-list.changed-by.user', 'User')}</div>
                        {#if by.user.urn}<Urn value={by.user.urn} type="user" size={8} />{/if}
                      </div>
                    {/if}
                    {#if by.worker}
                      <div data-testid="changed-by-worker" class="min-w-0">
                        <div class="truncate text-zinc-700 dark:text-zinc-300">{by.worker.name}</div>
                        {#if by.worker.urn}<Urn value={by.worker.urn} type="worker" linked size={8} />{/if}
                      </div>
                    {/if}
                    {#if by.agent}
                      <div data-testid="changed-by-agent" class="mt-1 min-w-0">
                        <div class="truncate text-zinc-600 dark:text-zinc-400">{by.agent.name}</div>
                        {#if by.agent.urn}<Urn value={by.agent.urn} type="agent" linked size={8} />{/if}
                      </div>
                    {/if}
                    {#if c && !by.user && !by.worker && !by.agent}<span class="text-zinc-400">—</span>{/if}
                  </td>
                {:else if cell.column.id === 'revision'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs tabular-nums text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    {c ? (c.revision ?? '—') : ''}
                  </td>
                {:else if cell.column.id === 'approved'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">{approvedCellText(c) || (c ? '—' : '')}</td>
                {:else if cell.column.id === 'signed'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">{#if !signingOffered}<span class="text-zinc-400" title={t('node-list.signing-off-title', 'Signing is not enabled on this server')}>{t('node-list.signing-off', 'Off')}</span>{:else}{signedCellText(c) || (c ? '—' : '')}{/if}</td>
                {:else if cell.column.id === 'nodeType'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{n.nodeType}</span>
                  </td>
                {:else}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
                    <div class="truncate">{n.description ?? '—'}</div>
                  </td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if !orderable && !serverPaged}
      <!-- Footer: page size (left of Prev/Next) + pagination; always visible.
           Both rows wrap (#1270): this is the same footer DataTable carries —
           the select is sized by its longest option label and cannot shrink
           beside Previous/Next, so a no-wrap footer pushed the document wide
           on a 390px phone. -->
      <div data-testid="table-footer" class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-zinc-500">{pageCount > 1 ? `Page ${pageIndex + 1} of ${pageCount}` : ''}</span>
        <div class="flex flex-wrap items-center gap-2">
          <select value={pageSize} onchange={(e) => changePageSize(Number((e.target as HTMLSelectElement).value))}
            aria-label="Nodes per page"
            class="rounded-lg border border-zinc-300 !bg-zinc-100 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:!bg-zinc-800 dark:text-white">
            {#each PAGE_SIZES as size}
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
  {/if}
  {/snippet}
  {#if !hideSearch || !orderable}
    <TableFrame active={globalFilter.trim() !== ''} showSearch={!hideSearch} showViews={hasViews}>
      {#snippet controls()}
    {#if !hideSearch}
      <input
        type="text"
        placeholder="Search nodes..."
        bind:value={globalFilter}
        class="min-w-[10rem] max-w-sm flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    {/if}
    {#if hasViews && listKey}
      <ViewTabs {table} {listKey} bordered={false} class="min-w-[14rem] flex-1" />
    {/if}
    {#if !orderable}
      <!-- Right-align Columns only when nothing to its left (no ViewTabs and no
           search) already pushes it there. -->
      <div class={!listKey && hideSearch ? 'ml-auto' : ''}><ColumnToggle {table} /></div>
    {/if}
      {/snippet}
      {@render tableBody()}
    </TableFrame>
  {:else}
    {@render tableBody()}
  {/if}
</div>
