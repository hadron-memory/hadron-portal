<!--
  #1584 fold — a picker-shaped dialog (the shared Escape helper at the dialog
  layer, the CAPTURE fallback on the element) hosting a plain DataTable, so
  the table header's OWN floating layers — the ViewTabs caret menu, the
  ColumnToggle dropdown — can be pinned against it: the innermost open layer
  must own an Escape, not the dialog around it. `createSvelteTable` needs a
  runes effect context, so the table is built here (TableFooterHarness shape).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';

  interface Row { id: string; name: string }
  const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
  // The id column is hideable, or ColumnToggle renders nothing to pin.
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 240 },
    { accessorKey: 'id', header: 'ID', size: 340 },
  ];
  const table = createSvelteTable<Row>({
    data: rows,
    columns,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
  let globalFilter = $state('');
  let open = $state(true);
  // #1591 item 2: a real picker's results table often mounts AFTER its dialog
  // (SelectNode shows it once a search lands), so the table's layers arm
  // after the dialog's fallback. `tableLater` reproduces that order.
  let { tableLater = false }: { tableLater?: boolean } = $props();
  let showTable = $state(untrack(() => !tableLater)); // read once: the order is fixed at mount
  const escapeFallback = { close: () => { open = false; } };
</script>

{#if open}
  <div role="dialog" aria-modal="true" aria-label="Choose a row" tabindex="-1" data-picker-dialog
    use:dialogEscapeFallback={escapeFallback}
    onkeydown={(event) => consumeEscapeAtDialog(event, escapeFallback)}
    class="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
    {#if showTable}
      <DataTable {table} listKey="test:inner-layers" showSearch={false} searchPlaceholder="" searchAriaLabel="" bind:globalFilter>
        {#snippet cell()}<span>x</span>{/snippet}
      </DataTable>
    {:else}
      <button type="button" data-load-results onclick={() => (showTable = true)}>Load results</button>
    {/if}
  </div>
{/if}
