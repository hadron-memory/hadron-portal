<script lang="ts">
  // Migrated off svelte-headless-table (Svelte-4, dormant) to @tanstack/table-core
  // + our Svelte 5 runes adapter. First production consumer of src/lib/table/*.
  // Public API (props) is unchanged so both call sites — MemoryBrowser (browse
  // list) and the node-detail Children tab (orderable) — keep working.
  import { onMount } from 'svelte';
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import Urn from './Urn.svelte';
  import ViewPicker from './table/ViewPicker.svelte';
  import ColumnToggle from './table/ColumnToggle.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import type { MemoryNode } from '$lib/types';

  let {
    nodes,
    basePath = '',
    memoryUrn = '',
    orderable = false,
    onreorder,
    listKey,
  }: {
    nodes: MemoryNode[];
    basePath?: string;
    memoryUrn?: string;
    orderable?: boolean;
    onreorder?: (orderedLocs: string[]) => void;
    /** When set (and not orderable), renders the saved-views picker. */
    listKey?: string;
  } = $props();

  function nodeHref(node: MemoryNode): string {
    if (basePath) return `${basePath}/nodes/${node.id}`;
    // #260: memory pages are org-less, so the fallback needs only the memory id.
    const memId = node.memory?.id;
    if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
    return '';
  }

  function nodeUrn(node: MemoryNode): string {
    // Some queries don't populate node.memory. Render bare loc rather than throw
    // and take down the whole list (data-shape concern, fixed at the loader).
    const u = memoryUrn || node.memory?.urn || '';
    return u && node.loc ? composeNodeUrn(u, node.loc) : node.loc;
  }

  // ── Page size (#275) ────────────────────────────────────────────────────
  const PAGE_SIZE_KEY = 'hadron:nodeList:pageSize';
  const PAGE_SIZES = [10, 25, 100];
  const DEFAULT_PAGE_SIZE = 25;

  // Global filter (search across the visible columns), held in runes state.
  let globalFilter = $state('');

  const columns: ColumnDef<MemoryNode>[] = [
    { accessorKey: 'name', header: 'Node', enableHiding: false }, // identity column — always shown
    { accessorKey: 'nodeType', header: 'Type' },
    { accessorFn: (n) => n.description ?? '', id: 'description', header: 'Description' },
  ];

  const table = createSvelteTable<MemoryNode>({
    get data() {
      return nodes;
    },
    columns,
    enableMultiSort: false,
    // In the orderable (children) list, manual drag order is the source of
    // truth — sorting would fight it, so it's disabled there (PR #277 review).
    enableSorting: !orderable,
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  onMount(() => {
    // Seed the legacy standalone page-size. When saved views are enabled, the
    // ViewPicker's init() is async (awaits storage), so it resumes AFTER this
    // synchronous seed and overrides the page size from the active view if one
    // exists — and leaves this seed in place when no view is active (spec D7).
    try {
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

  // Orderable (children) list shows every row so drag indices stay stable;
  // the browse list shows the current page.
  const displayRows = $derived(
    orderable ? table.getPrePaginationRowModel().rows : table.getRowModel().rows,
  );
  const pageSize = $derived(table.getState().pagination.pageSize);
  const pageIndex = $derived(table.getState().pagination.pageIndex);
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
  <div class="flex items-center gap-4">
    <input
      type="text"
      placeholder="Search nodes..."
      bind:value={globalFilter}
      class="max-w-sm flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
    />
    {#if !orderable}
      <select
        value={pageSize}
        onchange={(e) => changePageSize(Number((e.target as HTMLSelectElement).value))}
        aria-label="Nodes per page"
        class="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        {#each PAGE_SIZES as size}
          <option value={size}>{size} per page</option>
        {/each}
      </select>
    {/if}
    {#if !orderable}
      <ColumnToggle {table} />
    {/if}
    {#if !orderable && listKey}
      <ViewPicker {table} {listKey} />
    {/if}
  </div>

  {#if nodes.length === 0}
    <p class="text-sm text-zinc-500">No nodes.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {#if orderable}<th class="w-8 px-2 py-2.5"></th>{/if}
              {#each headerGroup.headers as header (header.id)}
                <th
                  class="select-none px-4 py-2.5 {header.column.getCanSort() ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : ''}"
                  onclick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                >
                  <div class="flex items-center gap-1">
                    {header.column.columnDef.header}
                    {#if header.column.getCanSort()}
                      <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>
                        {sortIndicator(header.column.getIsSorted())}
                      </span>
                    {/if}
                  </div>
                </th>
              {/each}
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each displayRows as row (row.id)}
            {@const n = row.original}
            {@const href = nodeHref(n)}
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
                <td class="w-8 cursor-grab select-none px-2 py-2.5 text-zinc-400" title="Drag to reorder">⠿</td>
              {/if}
              {#each row.getVisibleCells() as cell (cell.id)}
                {#if cell.column.id === 'name'}
                  <td class="px-4 py-2.5">
                    <div>
                      {#if href}
                        <a {href} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{n.name}</a>
                      {:else}
                        <span class="font-medium text-zinc-900 dark:text-white">{n.name}</span>
                      {/if}
                      {#if n.seq !== null && n.seq !== undefined}
                        <span class="ml-1 text-xs tabular-nums text-zinc-400">#{n.seq}</span>
                      {/if}
                    </div>
                    <div class="mt-0.5"><Urn value={nodeUrn(n)} type="node" size={8} /></div>
                  </td>
                {:else if cell.column.id === 'nodeType'}
                  <td class="px-4 py-2.5">
                    <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{n.nodeType}</span>
                  </td>
                {:else}
                  <td class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{n.description ?? '—'}</td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if !orderable && pageCount > 1}
      <div class="flex items-center justify-between">
        <span class="text-sm text-zinc-500">Page {pageIndex + 1} of {pageCount}</span>
        <div class="flex gap-2">
          <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</button>
          <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</button>
        </div>
      </div>
    {/if}
  {/if}
</div>
