<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { fitOnPhone = true, multiColumn = false, stickyEndColumn, secondSize = 400, rowClass, phoneHiddenColumns, hiddenColumns = [] }: { hiddenColumns?: string[]; phoneHiddenColumns?: string[]; fitOnPhone?: boolean; multiColumn?: boolean; stickyEndColumn?: string; secondSize?: number; rowClass?: (item: { name: string }) => string } = $props();
  const columns = $derived<PortalColumnDef<{ name: string }>[]>([
    { accessorKey: 'name', header: 'Name', size: 1600, enableHiding: false },
    ...(multiColumn ? [{ accessorKey: 'name', id: 'second', header: 'Second', size: secondSize, enableHiding: false }] : []),
  ]);
  // The initial state is read once on purpose: it models a restored saved view.
  // svelte-ignore state_referenced_locally
  const table = createSvelteTable({ data: [{ name: 'Row' }], get columns() { return columns; }, initialState: { columnVisibility: Object.fromEntries(hiddenColumns.map((id) => [id, false])) } });
  let globalFilter = $state('');
</script>

<DataTable {table} {fitOnPhone} {phoneHiddenColumns} {stickyEndColumn} {rowClass} listKey="test:fit-on-phone" searchPlaceholder="Search" searchAriaLabel="Search" bind:globalFilter>
  {#snippet cell()}<span>Row</span>{/snippet}
</DataTable>
