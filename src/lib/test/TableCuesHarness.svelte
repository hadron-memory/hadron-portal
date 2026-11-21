<!--
  Test harness for the shared DataTable footer and sort-header cues (#2287): the row count and
  `sortButtons` are props so one file can pin zero rows, one page, several pages, and both header
  modes. `createSvelteTable` needs a runes effect context, so the table is built here.
-->
<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';

  interface Row { id: string; name: string }
  let { rowCount = 0, sortButtons = false }: { rowCount?: number; sortButtons?: boolean } = $props();
  // svelte-ignore state_referenced_locally -- the harness is mounted once per row count; it never changes after mount
  const rows: Row[] = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 240 },
    { accessorKey: 'id', header: 'ID', size: 340, enableSorting: false },
  ];
  const table = createSvelteTable<Row>({
    data: rows,
    columns,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  let globalFilter = $state('');
</script>

<DataTable {table} listKey="test:cues" {sortButtons} searchPlaceholder="Search" searchAriaLabel="Search" bind:globalFilter>
  {#snippet cell()}<span>x</span>{/snippet}
</DataTable>
