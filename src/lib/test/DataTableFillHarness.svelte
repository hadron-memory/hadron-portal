<script lang="ts">
 import DataTable from '$lib/components/table/DataTable.svelte';
 import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
 let { rows = 3, headerHeight = 120, bounded = false }: { rows?: number; headerHeight?: number; bounded?: boolean } = $props();

 // svelte-ignore state_referenced_locally
 const table = createSvelteTable({ data: Array.from({ length: rows }, (_, i) => ({ name: `Row ${i}` })), columns: [{ accessorKey: 'name', header: 'Name', size: 160 }] });
</script>
<!-- A page header of arbitrary height above a full-page list (portal#2193). -->
<div data-testid="page-header" data-height={headerHeight} style="height: {headerHeight}px">Header</div>
<DataTable {table} listKey="test:fill" showSearch={false} searchPlaceholder="" searchAriaLabel="" {bounded}>
 {#snippet cell(c)}{c.getValue()}{/snippet}
</DataTable>
