<!--
  #992 slice C — what blocks minting a memory's nodes, as a TanStack grid (a
  list of findings is tabular, per CLAUDE.md). Each row is one blocker: its
  kind as fixed copy, the node by URN, and the detail the report gives (a lint
  rule, or the cited target). The server's finding prose is not shown.
-->
<script lang="ts" module>
  import type { ColumnSearchExtras } from '$lib/table/global-filter';

  export interface MintBlockerRow {
    id: string;
    kindText: string;
    loc: string;
    urn: string | null;
    detail: string | null;
    /** The detail is itself a node URN (a cited node in another memory). */
    detailIsUrn: boolean;
  }

  /** Every cell's rendered text is searchable, URNs included. */
  export const mintBlockerSearchExtras: ColumnSearchExtras<MintBlockerRow> = {
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

  let { rows }: { rows: MintBlockerRow[] } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<MintBlockerRow>[] = [
    { accessorKey: 'kindText', header: t('memory.mint.column.blocker', 'Blocker'), size: 220 },
    { accessorKey: 'loc', header: t('memory.mint.column.node', 'Node'), enableHiding: false, size: 320 },
    { accessorKey: 'detail', header: t('memory.mint.column.detail', 'Detail'), size: 220 },
  ];

  const table = createSvelteTable<MintBlockerRow>({
    get data() {
      return rows;
    },
    columns,
    getRowId: (row) => row.id,
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
    globalFilterFn: makeGlobalFilterFn<MintBlockerRow>({}, mintBlockerSearchExtras),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  listKey="memories:mint:blockers"
  bind:globalFilter
  bounded
  searchPlaceholder={t('memory.mint.search', 'Search blockers…')}
  searchAriaLabel={t('memory.mint.search.aria', 'Search what blocks minting')}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'kindText'}
      <!-- portal#2492: a blocker kind, a loc and a detail have no break opportunity, so they wrap anywhere inside the cell. -->
      <span class="block min-w-0 max-w-full [overflow-wrap:anywhere] text-xs text-zinc-700 dark:text-zinc-300">{row.kindText}</span>
    {:else if c.column.id === 'loc'}
      {#if row.urn}
        <Urn value={row.urn} type="node" linked size={9} />
      {:else}
        <span class="block min-w-0 max-w-full [overflow-wrap:anywhere] font-mono text-xs">{row.loc}</span>
      {/if}
    {:else if c.column.id === 'detail'}
      {#if row.detail && row.detailIsUrn}
        <Urn value={row.detail} type="node" size={9} />
      {:else if row.detail}
        <span class="block min-w-0 max-w-full [overflow-wrap:anywhere] font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.detail}</span>
      {/if}
    {/if}
  {/snippet}
</DataTable>
