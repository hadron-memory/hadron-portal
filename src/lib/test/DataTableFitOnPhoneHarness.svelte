<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { fitOnPhone = true, multiColumn = false, stickyEndColumn, secondSize = 400, rowClass, phoneHiddenColumns }: { phoneHiddenColumns?: string[]; fitOnPhone?: boolean; multiColumn?: boolean; stickyEndColumn?: string; secondSize?: number; rowClass?: (item: { name: string }) => string } = $props();
  const columns = $derived<PortalColumnDef<{ name: string }>[]>([
    { accessorKey: 'name', header: 'Name', size: 1600, enableHiding: false },
    ...(multiColumn ? [{ accessorKey: 'name', id: 'second', header: 'Second', size: secondSize, enableHiding: false }] : []),
  ]);
  const table = createSvelteTable({ data: [{ name: 'Row' }], get columns() { return columns; } });
  let globalFilter = $state('');
</script>

<DataTable {table} {fitOnPhone} {phoneHiddenColumns} {stickyEndColumn} {rowClass} listKey="test:fit-on-phone" searchPlaceholder="Search" searchAriaLabel="Search" bind:globalFilter>
  {#snippet cell()}<span>Row</span>{/snippet}
</DataTable>
