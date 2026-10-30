<!--
  portal#1346 — the nodes whose last embed attempt failed, and why, as a TanStack
  grid. Node, location and reason are tabular and the list can run to a thousand
  findings, so per CLAUDE.md it is a `DataTable`, not a `<ul>` (George on #1460).
-->
<script lang="ts" module>
  import type { ColumnSearchExtras } from '$lib/table/global-filter';
  import type { VectorHealthRow } from '$lib/vector-health';

  /** The URN chip is not the node column's accessor, so a reader pasting one still finds the row. */
  export const vectorHealthSearchExtras: ColumnSearchExtras<VectorHealthRow> = {
    nodeLoc: (row) => row.nodeUrn ?? '',
  };
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';

  let { rows, memoryId }: { rows: VectorHealthRow[]; memoryId: string } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<VectorHealthRow>[] = [
    { accessorKey: 'nodeLoc', header: t('memory-settings.vector-health.col.node', 'Node'), enableHiding: false, size: 320 },
    { accessorKey: 'detail', header: t('memory-settings.vector-health.col.reason', 'Why it failed'), size: 440 },
  ];

  const table = createSvelteTable<VectorHealthRow>({
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
    globalFilterFn: makeGlobalFilterFn<VectorHealthRow>({}, vectorHealthSearchExtras),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  listKey="memory:vector-health-failed"
  bind:globalFilter
  maxHeight="max(160px, 40vh)"
  searchPlaceholder={t('memory-settings.vector-health.search', 'Search failed nodes…')}
  searchAriaLabel={t('memory-settings.vector-health.search.aria', 'Search the nodes whose embedding failed')}
  rowAttrs={() => ({ 'data-testid': 'vector-health-row' })}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'nodeLoc'}
      <div class="min-w-0">
        <a href={`/app/memories/${memoryId}/nodes/${row.nodeId}`} class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.nodeLoc}</a>
        {#if row.nodeUrn}<div class="mt-0.5"><Urn value={row.nodeUrn} type="node" size={8} /></div>{/if}
      </div>
    {:else if c.column.id === 'detail'}
      <div class="break-words text-xs text-red-700 dark:text-red-300">{row.detail}</div>
    {/if}
  {/snippet}
</DataTable>
