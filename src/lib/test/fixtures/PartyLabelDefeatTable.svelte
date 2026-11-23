<!--
  portal#2506 — the PartyLabel containment pin's table.

  A real DataTable whose Party cell reproduces the defeating caller verbatim:
  TasksRoster's reportsTo wrapper (`inline-flex flex-wrap items-center gap-1`,
  no max-w-full/min-w-0 — the one shape still unbounded at main when #2506 was
  filed). A caller may legally wrap PartyLabel this way; the shared component
  has to contain itself. The other columns exist so the declared sizes bind at
  both probed widths (total 1400px > 1280): with surplus spread a wider table
  would widen the Party column and the defeat would never bind (the wake
  battery documented the same skip).
-->
<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import PartyLabel from '$lib/components/agent-tasks/PartyLabel.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AgentTaskParty } from '$lib/agent-tasks/types';

  export type PartyLabelDefeatRow = { id: string; party: AgentTaskParty | null; note: string };

  let { rows }: { rows: PartyLabelDefeatRow[] } = $props();

  const columns: PortalColumnDef<PartyLabelDefeatRow>[] = [
    { id: 'party', accessorFn: (r) => r.party?.name ?? '', header: 'Party', enableHiding: false, size: 200 },
    { id: 'detail', accessorFn: (r) => r.note, header: 'Detail', enableSorting: false, size: 400 },
    { id: 'refs', accessorFn: (r) => r.id, header: 'Refs', size: 400 },
    { id: 'since', accessorFn: (r) => r.id, header: 'Since', size: 400 },
  ];
  const table = createSvelteTable<PartyLabelDefeatRow>({
    get data() {
      return rows;
    },
    columns,
    enableMultiSort: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<DataTable {table} listKey="party-label:defeat" searchPlaceholder="Search…" searchAriaLabel="Search…" showSearch={false} showFooter={false} showPageSize={false}>
  {#snippet cell(cell, row)}
    {#if cell.column.id === 'party'}
      <!-- portal#2506: the defeating caller wrapper, verbatim from TasksRoster's
           reportsTo cell — a caller may legally omit max-w-full/min-w-0, so the
           shared component must not lean on the caller bounding it. -->
      <span class="inline-flex flex-wrap items-center gap-1"><PartyLabel party={row.party} /></span>
    {:else}
      <span class="block max-w-full truncate" title={String(cell.getValue() || '')}>{cell.getValue() || '—'}</span>
    {/if}
  {/snippet}
</DataTable>
