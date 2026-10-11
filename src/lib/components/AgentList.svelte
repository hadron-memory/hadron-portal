<script lang="ts">
  // Migrated off svelte-headless-table to @tanstack/table-core + the Svelte 5
  // runes adapter (src/lib/table/*). See docs/grid-bakeoff.md.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { t } from '$lib/i18n/t';
  import Urn from './Urn.svelte';
  import ViewTabs from './table/ViewTabs.svelte';
  import TableFrame from './table/TableFrame.svelte';
  import ColumnToggle from './table/ColumnToggle.svelte';

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
    listKey,
  }: {
    agents: AgentRow[];
    /** Optional action shown as a trailing column. */
    onremove?: (agent: AgentRow) => void;
    removeLabel?: string;
    /** When set, renders the saved-views picker. */
    listKey?: string;
  } = $props();

  function agentHref(agent: AgentRow): string {
    return `/app/agents/${agent.id}`;
  }

  let globalFilter = $state('');

  const columns: PortalColumnDef<AgentRow>[] = [
    { accessorKey: 'name', header: t('common.agent', 'Agent'), enableHiding: false, size: 300 }, // identity column
    { accessorFn: (a) => a.description ?? '', id: 'description', header: t('common.description', 'Description'), size: 400 },
  ];

  const table = createSvelteTable<AgentRow>({
    get data() {
      return agents;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
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
  });

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
</script>

<div class="space-y-3">

  {#if agents.length === 0}
    <p class="text-sm text-zinc-500">No agents.</p>
  {:else}
    <TableFrame active={globalFilter.trim() !== ''}>
      {#snippet controls()}
        <input type="text" placeholder="Search agents..." bind:value={globalFilter}
        class="min-w-[10rem] max-w-sm flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
        {#if listKey}<ViewTabs {table} {listKey} bordered={false} class="min-w-[14rem] flex-1" />{/if}
        <ColumnToggle {table} />
      {/snippet}
    <div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: 60vh;">
      <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize() + (onremove ? 80 : 0)}px);">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {#each headerGroup.headers as header (header.id)}
                <th
                  class="sticky top-0 z-10 cursor-pointer select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:text-zinc-200"
                  style="width: {header.getSize()}px;"
                  onclick={header.column.getToggleSortingHandler()}
                >
                  <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 truncate">{header.column.columnDef.header}</span>
                    <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>{sortIndicator(header.column.getIsSorted())}</span>
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
              {#if onremove}<th class="sticky top-0 z-10 w-20 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"></th>{/if}
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          <!-- Pre-paginated: this grid shows every row and renders no pager.
               The shared feature registry enables rowPaginationFeature for all
               grids, and v9 resolves getRowModel() to getPaginatedRowModel()
               (default pageSize 10) — so getRowModel() here would silently hide
               rows 11+ with no way to reach them. -->
          {#each table.getPrePaginatedRowModel().rows as row (row.id)}
            {@const agent = row.original}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              {#each row.getVisibleCells() as cell (cell.id)}
                {#if cell.column.id === 'name'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <div class="truncate">
                      <a href={agentHref(agent)} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{agent.name}</a>
                    </div>
                    <div class="mt-0.5 truncate"><Urn value={agent.urn} type="agent" size={8} /></div>
                  </td>
                {:else if cell.column.id === 'description'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
                    <div class="truncate">{agent.description ?? '—'}</div>
                  </td>
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
    </TableFrame>
  {/if}
</div>
