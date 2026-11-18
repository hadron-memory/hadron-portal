<!--
  Test harness for the shared DataTable footer (#1270): a wide two-page table
  (25 rows over pageSize 20), so the pagination row renders the exact shape
  that overflowed a 390px phone — page indicator beside a content-sized
  rows-per-page select and Previous/Next. `createSvelteTable` needs a runes
  effect context, so the table is built here, not in the test body.
-->
<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';

  interface Row { id: string; name: string }
  const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 240 },
    { accessorKey: 'id', header: 'ID', size: 340 },
  ];

  const table = createSvelteTable<Row>({
    data: rows,
    columns,
    // The Apps tab's page size (20), so 25 rows paginate the same way.
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  let globalFilter = $state('');
</script>

<DataTable {table} listKey="test:footer" searchPlaceholder="Search" searchAriaLabel="Search" bind:globalFilter>
  {#snippet cell()}<span>x</span>{/snippet}
</DataTable>
