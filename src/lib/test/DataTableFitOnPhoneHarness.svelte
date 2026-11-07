<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { fitOnPhone = true }: { fitOnPhone?: boolean } = $props();
  const columns: PortalColumnDef<{ name: string }>[] = [{ accessorKey: 'name', header: 'Name', size: 1600, enableHiding: false }];
  const table = createSvelteTable({ data: [{ name: 'Row' }], columns });
  let globalFilter = $state('');
</script>

<DataTable {table} {fitOnPhone} listKey="test:fit-on-phone" searchPlaceholder="Search" searchAriaLabel="Search" bind:globalFilter>
  {#snippet cell()}<span>Row</span>{/snippet}
</DataTable>
