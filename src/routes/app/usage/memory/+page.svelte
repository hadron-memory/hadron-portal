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
  import ViewPicker from '$lib/components/table/ViewPicker.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  interface UsageEvent {
    id: string; type: string; nodeLoc: string | null; appId: string | null;
    sessionId: string | null; model: string | null; tokensIn: number | null;
    tokensOut: number | null; createdAt: string;
  }

  function formatDate(val: string | null): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let globalFilter = $state('');

  // Columns hold raw, sortable accessor values; display formatting is applied
  // at render time via `fmt` (keyed by column id) so numeric/date sort is kept.
  const columns: ColumnDef<UsageEvent>[] = [
    { accessorKey: 'createdAt', header: 'Time' },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'nodeLoc', header: 'Node' },
    { accessorKey: 'model', header: 'Model' },
    { accessorFn: (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0), id: 'tokens', header: 'Tokens' },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    createdAt: (v) => formatDate(v as string | null),
    nodeLoc: (v) => (v as string | null) ?? '—',
    model: (v) => (v as string | null) ?? '—',
    tokens: (v) => ((v as number) > 0 ? (v as number).toLocaleString() : '—'),
  };

  const table = createSvelteTable<UsageEvent>({
    get data() {
      return data.events as UsageEvent[];
    },
    columns,
    enableMultiSort: false,
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

<svelte:head><title>Memory Usage · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Memory Usage' },
  ]} />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Memory Usage</h1>

  <!-- Filter + page size -->
  <div class="flex items-center gap-4">
    <input type="text" placeholder="Search events..." bind:value={globalFilter}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    <select value={pageSize} onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
      class="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
      {#each [10, 20, 50, 100] as size}
        <option value={size}>{size} per page</option>
      {/each}
    </select>
    <ViewPicker {table} listKey="usage:memory" />
  </div>

  {#if data.events.length === 0}
    <p class="text-sm text-zinc-500">No usage events found.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {#each headerGroup.headers as header (header.id)}
                <th class="cursor-pointer select-none px-4 py-2.5 hover:text-zinc-700 dark:hover:text-zinc-200" onclick={header.column.getToggleSortingHandler()}>
                  <div class="flex items-center gap-1">
                    {header.column.columnDef.header}
                    <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>{sortIndicator(header.column.getIsSorted())}</span>
                  </div>
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
                <td class="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{f ? f(cell.getValue()) : cell.getValue()}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if pageCount > 1}
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
