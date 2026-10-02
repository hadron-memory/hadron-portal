<!--
  #992 — the placeholders an Approve all skipped, as a TanStack grid.

  A list of nodes is tabular, so per CLAUDE.md it is a `DataTable`, not a
  `<ul>` (@codex on #994). A spec corpus can reserve many citations, and the
  reader's next step is to find and fill specific ones, which search serves.
-->
<script lang="ts" module>
  import type { ColumnSearchExtras } from '$lib/table/global-filter';

  export interface SkippedPlaceholderRow {
    loc: string;
    /** The node URN, or null when it can't be composed (the loc then shows alone). */
    urn: string | null;
  }

  /**
   * The cell renders the URN, not the loc, so the URN is searchable too
   * (`hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable`).
   */
  export const skippedPlaceholderSearchExtras: ColumnSearchExtras<SkippedPlaceholderRow> = {
    loc: (row) => row.urn ?? '',
  };
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';

  let { rows }: { rows: SkippedPlaceholderRow[] } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<SkippedPlaceholderRow>[] = [
    { accessorKey: 'loc', header: t('memory.approve-all.column.placeholder', 'Placeholder'), enableHiding: false, size: 480 },
  ];

  const table = createSvelteTable<SkippedPlaceholderRow>({
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
    globalFilterFn: makeGlobalFilterFn<SkippedPlaceholderRow>({}, skippedPlaceholderSearchExtras),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  listKey="memories:approve-all:skipped-placeholders"
  bind:globalFilter
  maxHeight="max(160px, 40vh)"
  searchPlaceholder={t('memory.approve-all.search', 'Search skipped placeholders…')}
  searchAriaLabel={t('memory.approve-all.search.aria', 'Search the placeholders Approve all skipped')}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'loc'}
      {#if row.urn}
        <Urn value={row.urn} type="node" linked size={9} />
      {:else}
        <span class="font-mono text-xs">{row.loc}</span>
      {/if}
    {/if}
  {/snippet}
</DataTable>
