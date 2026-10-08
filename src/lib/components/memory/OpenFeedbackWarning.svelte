<!--
  portal#1014 — nodes with open discussion threads, in a memory-wide report
  (the mint check, Approve all). A warning, never a blocker: open feedback is a
  trust cue (hrn:node:hadronmemory.com:specs:cor:dmo:110:07).

  A list of nodes is tabular, so per CLAUDE.md it is a `DataTable`, not a
  `<ul>` (@codex on #994). Each surface passes its own `listKey`, since a
  shared key would share the persisted view.
-->
<script lang="ts" module>
  import type { ColumnSearchExtras } from '$lib/table/global-filter';
  import type { OpenFeedback } from '$lib/comments';

  /** The URN cell is what the reader sees, so it is what search matches. */
  export const openFeedbackSearchExtras: ColumnSearchExtras<OpenFeedback> = {
    urn: (row) => row.urn,
  };
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';

  let { items, text, listKey, testid = 'open-feedback' }: { items: OpenFeedback[]; text: string; listKey: string; testid?: string } = $props();

  let globalFilter = $state('');

  const columns: PortalColumnDef<OpenFeedback>[] = [
    { accessorKey: 'urn', header: t('memory.open-feedback.column.node', 'Node'), enableHiding: false, size: 420 },
    { accessorKey: 'openThreads', header: t('memory.open-feedback.column.open', 'Open discussions'), size: 140 },
  ];

  const table = createSvelteTable<OpenFeedback>({
    get data() {
      return items;
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
    globalFilterFn: makeGlobalFilterFn<OpenFeedback>({}, openFeedbackSearchExtras),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<div data-testid={testid} class="mt-2 space-y-2">
  <p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">{text}</p>
  <DataTable
    {table}
    {listKey}
    bind:globalFilter
    maxHeight="max(160px, 30vh)"
    searchPlaceholder={t('memory.open-feedback.search', 'Search nodes with open discussions…')}
    searchAriaLabel={t('memory.open-feedback.search.aria', 'Search the nodes that have open discussions')}
  >
    {#snippet cell(c, row)}
      {#if c.column.id === 'urn'}
        <Urn value={row.urn} type="node" linked size={9} />
      {:else if c.column.id === 'openThreads'}
        <span class="tabular-nums">{row.openThreads}</span>
      {/if}
    {/snippet}
  </DataTable>
</div>
