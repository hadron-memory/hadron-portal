<script lang="ts">
  import { createTable, Subscribe, Render } from 'svelte-headless-table';
  import { addSortBy, addTableFilter, addResizedColumns } from 'svelte-headless-table/plugins';
  import { readable } from 'svelte/store';
  import Urn from './Urn.svelte';

  // Lightweight row shape. Same fields as MemoryNode, but nothing is required
  // to be loaded eagerly — callers pick what they pass in.
  export interface NodeRow {
    id: string;
    loc: string;
    name: string;
    description?: string | null;
    nodeType?: string;
    /** Full URN (memory URN + ":" + loc). Rendered via <Urn type="node"/>. */
    urn: string;
  }

  let {
    nodes,
    onselect,
    searchPlaceholder = 'Search…',
    emptyLabel = 'No entries.',
  }: {
    nodes: NodeRow[];
    /** Called when a row is clicked. If not provided, rows are not clickable. */
    onselect?: (node: NodeRow) => void;
    searchPlaceholder?: string;
    emptyLabel?: string;
  } = $props();

  const store = $derived(readable(nodes));

  const table = $derived(createTable(store, {
    sort: addSortBy({ disableMultiSort: true }),
    filter: addTableFilter({
      fn: ({ filterValue, value }) =>
        String(value).toLowerCase().includes(String(filterValue).toLowerCase()),
    }),
    resize: addResizedColumns(),
  }));

  const columns = $derived(table.createColumns([
    table.column({ accessor: 'name', header: 'Name' }),
    table.column({
      accessor: (row: NodeRow) => row.description ?? '',
      header: 'Description',
      id: 'description',
    }),
  ]));

  const vm = $derived(table.createViewModel(columns));
  const headerRows = $derived(vm.headerRows);
  const rows = $derived(vm.rows);
  const tableAttrs = $derived(vm.tableAttrs);
  const tableBodyAttrs = $derived(vm.tableBodyAttrs);
  const filterValue = $derived(vm.pluginStates.filter.filterValue);
</script>

<div class="space-y-3">
  {#if nodes.length > 0}
    <input type="text" placeholder={searchPlaceholder} bind:value={$filterValue}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
  {/if}

  {#if nodes.length === 0}
    <p class="text-sm text-zinc-500">{emptyLabel}</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table {...$tableAttrs} class="w-full text-sm">
        <thead>
          {#each $headerRows as headerRow (headerRow.id)}
            <Subscribe rowAttrs={headerRow.attrs()} let:rowAttrs>
              <tr {...rowAttrs} class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {#each headerRow.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs props={cell.props()} let:props>
                    <th {...attrs} class="px-4 py-2.5 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200"
                      onclick={props.sort.toggle}
                      style={props.resize?.style ? `width: ${props.resize.style}` : undefined}
                    >
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
          {#each $rows as row (row.id)}
            {@const n = row.original as NodeRow}
            <Subscribe rowAttrs={row.attrs()} let:rowAttrs>
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <tr {...rowAttrs}
                class="bg-white dark:bg-zinc-950 {onselect ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900' : ''}"
                onclick={() => onselect?.(n)}
              >
                {#each row.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs>
                    {#if cell.id === 'name'}
                      <td {...attrs} class="px-4 py-2.5">
                        <div class="flex items-center gap-2">
                          <span class="font-medium {onselect ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-900 dark:text-white'}">{n.name}</span>
                          {#if n.nodeType}
                            <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{n.nodeType}</span>
                          {/if}
                        </div>
                        <div class="mt-0.5"><Urn value={n.urn} type="node" size={8} /></div>
                      </td>
                    {:else if cell.id === 'description'}
                      <td {...attrs} class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{n.description ?? '—'}</td>
                    {:else}
                      <td {...attrs} class="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                        <Render of={cell.render()} />
                      </td>
                    {/if}
                  </Subscribe>
                {/each}
              </tr>
            </Subscribe>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
