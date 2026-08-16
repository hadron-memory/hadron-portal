<script lang="ts">
  // Migrated off svelte-headless-table to @tanstack/table-core + the Svelte 5
  // runes adapter (src/lib/table/*). See docs/grid-bakeoff.md.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { t } from '$lib/i18n/t';
  import Urn from './Urn.svelte';
  import ViewTabs from './table/ViewTabs.svelte';
  import ColumnToggle from './table/ColumnToggle.svelte';

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
    listKey,
  }: {
    nodes: NodeRow[];
    /** Called when a row is clicked. If not provided, rows are not clickable. */
    onselect?: (node: NodeRow) => void;
    searchPlaceholder?: string;
    emptyLabel?: string;
    /** When set, renders the saved-views picker. */
    listKey?: string;
  } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<NodeRow>[] = [
    { accessorKey: 'name', header: t('common.name', 'Name'), enableHiding: false, size: 300 }, // identity column
    { accessorFn: (n) => n.description ?? '', id: 'description', header: t('common.description', 'Description'), size: 400 },
  ];

  const table = createSvelteTable<NodeRow>({
    get data() {
      return nodes;
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
  {#if nodes.length > 0}
    {#if listKey}<ViewTabs {table} {listKey} />{/if}
    <div class="flex flex-wrap items-center gap-3">
      <input type="text" placeholder={searchPlaceholder} bind:value={globalFilter}
        class="max-w-sm flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      <ColumnToggle {table} />
    </div>
  {/if}

  {#if nodes.length === 0}
    <p class="text-sm text-zinc-500">{emptyLabel}</p>
  {:else}
    <div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: 60vh;">
      <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize()}px);">
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
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each table.getRowModel().rows as row (row.id)}
            {@const n = row.original}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class="bg-white dark:bg-zinc-950 {onselect ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900' : ''}"
              onclick={() => onselect?.(n)}
            >
              {#each row.getVisibleCells() as cell (cell.id)}
                {#if cell.column.id === 'name'}
                  <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="min-w-0 truncate font-medium {onselect ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-900 dark:text-white'}">{n.name}</span>
                      {#if n.nodeType}
                        <span class="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{n.nodeType}</span>
                      {/if}
                    </div>
                    <div class="mt-0.5 truncate"><Urn value={n.urn} type="node" size={8} /></div>
                  </td>
                {:else if cell.column.id === 'description'}
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
  {/if}
</div>
