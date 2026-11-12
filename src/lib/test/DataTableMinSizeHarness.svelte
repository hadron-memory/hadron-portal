<script lang="ts">
 import DataTable from '$lib/components/table/DataTable.svelte';
 import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
 import { applyView, normalizeView } from '$lib/table/savedView';
 const table = createSvelteTable({ data: [{ name: 'Row' }], columns: [
  { accessorKey: 'name', header: 'Action', minSize: 120, size: 160 },
  { id: 'legacy', accessorKey: 'name', header: 'Legacy', size: 160 },
 ] });
</script>
<button onclick={() => applyView(table, normalizeView({ columnSizing: { name: 10, legacy: 160 } }))}>Restore undersized view</button>
<DataTable {table} listKey="test:minimum" showSearch={false} searchPlaceholder="" searchAriaLabel="">
 {#snippet cell()}Row{/snippet}
</DataTable>
