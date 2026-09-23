<!--
  #879 — every checked task a download LEFT OUT, and why, as a TanStack grid.

  A list of tasks with a URN and a reason is tabular, so per CLAUDE.md it is a
  `DataTable`, not a `<ul>` (@codex on #890). One grid for both causes — the
  server refused the skill, or the task is exported for the other host only —
  because the reader's question is the same for both: which of my checked tasks
  is missing, and what do I do about it.
-->
<script lang="ts" module>
  import type { ColumnSearchExtras } from '$lib/table/global-filter';

  export interface LeftOutRow {
    name: string;
    urn: string;
    reason: string;
  }

  /**
   * The URN renders as a chip beside the name but is not the name column's
   * accessor, so it is added here — a reader pasting a URN finds the row
   * (`hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable`).
   */
  export const leftOutSearchExtras: ColumnSearchExtras<LeftOutRow> = {
    name: (row) => row.urn,
  };
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';

  let {
    rows,
    /** Unique per list: two lists on one key share a saved arrangement. */
    listKey = 'orgs:tasks:export-left-out',
  }: { rows: LeftOutRow[]; listKey?: string } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<LeftOutRow>[] = [
    { accessorKey: 'name', header: t('tasks.bundle.column.task', 'Task'), enableHiding: false, size: 300 },
    { accessorKey: 'reason', header: t('tasks.bundle.column.reason', 'Why it was left out'), size: 480 },
  ];

  const table = createSvelteTable<LeftOutRow>({
    get data() {
      return rows;
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
    globalFilterFn: makeGlobalFilterFn<LeftOutRow>({}, leftOutSearchExtras),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  {listKey}
  bind:globalFilter
  maxHeight="max(160px, 40vh)"
  searchPlaceholder={t('tasks.bundle.search', 'Search left-out tasks…')}
  searchAriaLabel={t('tasks.bundle.search.aria', 'Search the tasks left out of the download')}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'name'}
      <div class="min-w-0">
        <div class="truncate font-medium text-zinc-800 dark:text-zinc-200">{row.name}</div>
        <div class="mt-0.5"><Urn value={row.urn} type="node" size={8} /></div>
      </div>
    {:else if c.column.id === 'reason'}
      <div class="text-xs text-zinc-600 dark:text-zinc-400">{row.reason}</div>
    {/if}
  {/snippet}
</DataTable>
