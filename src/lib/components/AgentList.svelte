<script lang="ts">
  // Migrated off svelte-headless-table to @tanstack/table-core + the Svelte 5
  // runes adapter (src/lib/table/*). See docs/grid-bakeoff.md.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
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

  let globalFilter = $state('');

  const columns: ColumnDef<AgentRow>[] = [
    { accessorKey: 'name', header: 'Agent' },
    { accessorFn: (a) => a.description ?? '', id: 'description', header: 'Description' },
  ];

  const table = createSvelteTable<AgentRow>({
    get data() {
      return agents;
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
</script>

<div class="space-y-3">
  {#if agents.length > 0}
    <input type="text" placeholder="Search agents..." bind:value={globalFilter}
      class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
  {/if}

  {#if agents.length === 0}
    <p class="text-sm text-zinc-500">No agents.</p>
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
              {#if onremove}<th class="w-20 px-4 py-2.5"></th>{/if}
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each table.getRowModel().rows as row (row.id)}
            {@const agent = row.original}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              {#each row.getVisibleCells() as cell (cell.id)}
                {#if cell.column.id === 'name'}
                  <td class="px-4 py-2.5">
                    <div>
                      <a href={agentHref(agent)} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{agent.name}</a>
                    </div>
                    <div class="mt-0.5"><Urn value={agent.urn} type="agent" size={8} /></div>
                  </td>
                {:else}
                  <td class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{agent.description ?? '—'}</td>
                {/if}
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
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
