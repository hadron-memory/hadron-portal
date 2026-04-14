<script lang="ts">
  import { createTable, Subscribe, Render } from 'svelte-headless-table';
  import { addSortBy, addTableFilter, addResizedColumns } from 'svelte-headless-table/plugins';
  import { readable } from 'svelte/store';
  import Urn from './Urn.svelte';

  // Minimal shape — callers only need to supply these. Additional fields
  // are ignored. `orgId` is required to build hotlink targets.
  export interface AgentRow {
    id: string;
    urn: string;
    name: string;
    description?: string | null;
    orgId: string;
  }

  let {
    agents,
    onremove,
    removeLabel = 'Remove',
  }: {
    agents: AgentRow[];
    /** Optional action shown as a trailing column. */
    onremove?: (agent: AgentRow) => void;
    removeLabel?: string;
  } = $props();

  function agentHref(agent: AgentRow): string {
    return `/app/agents/${agent.id}`;
  }

  const store = $derived(readable(agents));

  const table = $derived(createTable(store, {
    sort: addSortBy({ disableMultiSort: true }),
    filter: addTableFilter({
      fn: ({ filterValue, value }) =>
        String(value).toLowerCase().includes(String(filterValue).toLowerCase()),
    }),
    resize: addResizedColumns(),
  }));

  const columns = $derived(table.createColumns([
    table.column({ accessor: 'name', header: 'Agent' }),
    table.column({
      accessor: (row: AgentRow) => row.description ?? '',
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
  {#if agents.length > 0}
    <input type="text" placeholder="Search agents..." bind:value={$filterValue}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
  {/if}

  {#if agents.length === 0}
    <p class="text-sm text-zinc-500">No agents.</p>
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
                {#if onremove}<th class="w-20 px-4 py-2.5"></th>{/if}
              </tr>
            </Subscribe>
          {/each}
        </thead>
        <tbody {...$tableBodyAttrs} class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each $rows as row (row.id)}
            {@const agent = row.original as AgentRow}
            <Subscribe rowAttrs={row.attrs()} let:rowAttrs>
              <tr {...rowAttrs} class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                {#each row.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs>
                    {#if cell.id === 'name'}
                      <td {...attrs} class="px-4 py-2.5">
                        <div>
                          <a href={agentHref(agent)} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{agent.name}</a>
                        </div>
                        <div class="mt-0.5"><Urn value={agent.urn} type="agent" size={8} /></div>
                      </td>
                    {:else if cell.id === 'description'}
                      <td {...attrs} class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{agent.description ?? '—'}</td>
                    {:else}
                      <td {...attrs} class="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                        <Render of={cell.render()} />
                      </td>
                    {/if}
                  </Subscribe>
                {/each}
                {#if onremove}
                  <td class="w-20 px-4 py-2.5 text-right">
                    <button type="button" onclick={() => onremove?.(agent)}
                      class="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                      {removeLabel}
                    </button>
                  </td>
                {/if}
              </tr>
            </Subscribe>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
