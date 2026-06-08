<script lang="ts">
  // BAKE-OFF SPIKE (#275 follow-up) — NodeList on @tanstack/table-core + the
  // custom Svelte 5 runes adapter. Read-only; focuses on the saved-view
  // features (sort, multi-column filter, column show/hide + order, pagination)
  // and how cleanly a view serializes. Not wired into the app.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { extractView, serializeView, viewToInitialState, type SavedView } from '$lib/table/savedView';
  import type { MemoryNode } from '$lib/types';

  let {
    nodes,
    basePath = '',
    initialView = null,
  }: { nodes: MemoryNode[]; basePath?: string; initialView?: SavedView | null } = $props();

  const columns: ColumnDef<MemoryNode>[] = [
    { accessorKey: 'name', header: 'Node' },
    { accessorKey: 'nodeType', header: 'Type' },
    { accessorKey: 'description', header: 'Description', cell: (c) => c.getValue() ?? '—' },
  ];

  let globalFilter = $state('');

  const table = createSvelteTable<MemoryNode>({
    get data() {
      return nodes;
    },
    columns,
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: viewToInitialState(initialView),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Saved view = plain JSON of five state slices. This is the headline.
  const viewJson = $derived(serializeView(extractView(table.getState())));

  function nodeHref(n: MemoryNode): string {
    return basePath ? `${basePath}/nodes/${n.id}` : '';
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3">
    <input
      type="text"
      placeholder="Search..."
      bind:value={globalFilter}
      class="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
    <select
      value={table.getState().pagination.pageSize}
      onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
      class="rounded-lg border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      {#each [10, 25, 100] as size}
        <option value={size}>{size} per page</option>
      {/each}
    </select>

    <!-- Column show/hide — columnVisibility is part of the saved view -->
    <div class="flex items-center gap-2 text-xs">
      {#each table.getAllLeafColumns() as col}
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={col.getIsVisible()} onchange={col.getToggleVisibilityHandler()} />
          {col.id}
        </label>
      {/each}
    </div>
  </div>

  <table class="w-full text-sm">
    <thead>
      {#each table.getHeaderGroups() as hg (hg.id)}
        <tr class="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
          {#each hg.headers as header (header.id)}
            <th
              class="cursor-pointer select-none px-4 py-2.5"
              onclick={header.column.getToggleSortingHandler()}
            >
              {header.column.columnDef.header}
              {#if header.column.getIsSorted() === 'asc'}▲{:else if header.column.getIsSorted() === 'desc'}▼{/if}
            </th>
          {/each}
        </tr>
      {/each}
    </thead>
    <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
      {#each table.getRowModel().rows as row (row.id)}
        {@const n = row.original}
        <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-900">
          {#each row.getVisibleCells() as cell (cell.id)}
            <td class="px-4 py-2.5">
              {#if cell.column.id === 'name' && nodeHref(n)}
                <a href={nodeHref(n)} class="font-medium text-indigo-600 hover:underline">{n.name}</a>
              {:else}
                {cell.getValue() ?? '—'}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="flex items-center justify-between">
    <span class="text-sm text-zinc-500">
      Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
    </span>
    <div class="flex gap-2">
      <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
        class="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
      <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
        class="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
    </div>
  </div>

  <details class="text-xs">
    <summary class="cursor-pointer text-zinc-500">Saved view (serialized JSON)</summary>
    <pre class="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 dark:bg-zinc-900">{viewJson}</pre>
  </details>
</div>
