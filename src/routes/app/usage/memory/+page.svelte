<script lang="ts">
  import { createTable, Subscribe, Render } from 'svelte-headless-table';
  import { addSortBy, addTableFilter, addPagination } from 'svelte-headless-table/plugins';
  import { readable } from 'svelte/store';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
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

  const events = readable<UsageEvent[]>(data.events as UsageEvent[]);

  const table = createTable(events, {
    sort: addSortBy({ disableMultiSort: true }),
    filter: addTableFilter({
      fn: ({ filterValue, value }) =>
        String(value).toLowerCase().includes(String(filterValue).toLowerCase()),
    }),
    page: addPagination({ initialPageSize: 20 }),
  });

  const columns = table.createColumns([
    table.column({ accessor: 'createdAt', header: 'Time', cell: ({ value }) => formatDate(value) }),
    table.column({ accessor: 'type', header: 'Type' }),
    table.column({ accessor: 'nodeLoc', header: 'Node', cell: ({ value }) => value ?? '—' }),
    table.column({ accessor: 'model', header: 'Model', cell: ({ value }) => value ?? '—' }),
    table.column({
      accessor: (row) => (row.tokensIn ?? 0) + (row.tokensOut ?? 0),
      header: 'Tokens',
      id: 'tokens',
      cell: ({ value }) => (value > 0 ? value.toLocaleString() : '—'),
    }),
  ]);

  const { headerRows, pageRows, tableAttrs, tableBodyAttrs, pluginStates } = table.createViewModel(columns);
  const { filterValue } = pluginStates.filter;
  const { pageIndex, pageCount, hasNextPage, hasPreviousPage, pageSize } = pluginStates.page;
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
    <input type="text" placeholder="Search events..." bind:value={$filterValue}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    <select bind:value={$pageSize} class="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
      <option value={10}>10 per page</option>
      <option value={20}>20 per page</option>
      <option value={50}>50 per page</option>
      <option value={100}>100 per page</option>
    </select>
  </div>

  {#if data.events.length === 0}
    <p class="text-sm text-zinc-500">No usage events found.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table {...$tableAttrs} class="w-full text-sm">
        <thead>
          {#each $headerRows as headerRow (headerRow.id)}
            <Subscribe rowAttrs={headerRow.attrs()} let:rowAttrs>
              <tr {...rowAttrs} class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {#each headerRow.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs props={cell.props()} let:props>
                    <th {...attrs} class="px-4 py-2.5 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200" onclick={props.sort.toggle}>
                      <div class="flex items-center gap-1">
                        <Render of={cell.render()} />
                        {#if props.sort.order === 'asc'}
                          <span class="text-indigo-500">▲</span>
                        {:else if props.sort.order === 'desc'}
                          <span class="text-indigo-500">▼</span>
                        {:else}
                          <span class="text-zinc-300 dark:text-zinc-700">⇅</span>
                        {/if}
                      </div>
                    </th>
                  </Subscribe>
                {/each}
              </tr>
            </Subscribe>
          {/each}
        </thead>
        <tbody {...$tableBodyAttrs} class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each $pageRows as row (row.id)}
            <Subscribe rowAttrs={row.attrs()} let:rowAttrs>
              <tr {...rowAttrs} class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                {#each row.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs>
                    <td {...attrs} class="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                      <Render of={cell.render()} />
                    </td>
                  </Subscribe>
                {/each}
              </tr>
            </Subscribe>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between">
      <span class="text-sm text-zinc-500">Page {$pageIndex + 1} of {$pageCount}</span>
      <div class="flex gap-2">
        <button disabled={!$hasPreviousPage} onclick={() => $pageIndex--}
          class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</button>
        <button disabled={!$hasNextPage} onclick={() => $pageIndex++}
          class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</button>
      </div>
    </div>
  {/if}
</div>
