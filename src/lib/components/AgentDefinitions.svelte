<script lang="ts">
  import type { DefinitionEntry, DefinitionRead } from '$lib/agent-inheritance';
  import { definitionEntryHref } from '$lib/agent-inheritance';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { t } from '$lib/i18n/t';
  let { agentId, read, processes = false }: { agentId: string; read: DefinitionRead; processes?: boolean } = $props();
  let filter = $state('');
  const rows = $derived(read.items ?? []);
  const columns = $derived<PortalColumnDef<DefinitionEntry>[]>([
    { id: 'name', accessorFn: r => r.node.name, header: t('agent.definitions.name', 'Name'), enableHiding: false, size: 230 },
    ...(processes ? [{ id: 'kind', accessorFn: (r: DefinitionEntry) => r.kind === 'STARTS' ? t('agent.process.starts', 'Starts / owns') : r.kind === 'INVOLVED' ? t('agent.process.involved', 'Involved') : r.kind ?? '—', header: t('agent.process.relationship', 'Relationship'), size: 170 }] : []),
    { accessorKey: 'trigger', header: t('agent.definitions.trigger', 'Trigger'), size: 240 },
    { id: 'urn', accessorFn: r => r.node.urn, header: t('agent.definitions.urn', 'URN'), size: 350 },
    { id: 'origin', accessorFn: r => r.node.inheritedFrom?.agentUrn ?? '', header: t('agent.definitions.origin', 'Inherited from'), size: 350 },
  ]);
  const table = createSvelteTable<DefinitionEntry>({
    get data() { return rows; },
    get columns() { return columns; },
    enableMultiSort: false, enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return filter; } },
    onGlobalFilterChange: u => { filter = typeof u === 'function' ? u(filter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

{#if read.error}
  <p role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{read.error}</p>
{:else}
  {#if read.items?.length === 0}
  <p class="text-sm text-zinc-500">{processes ? t('agent.processes.empty', 'No processes listed.') : t('agent.tasks.empty', 'No tasks listed.')}</p>
  {/if}
  <DataTable {table} listKey={processes ? 'agent-definition-processes' : 'agent-definition-tasks'} bind:globalFilter={filter}
    searchPlaceholder={t('agent.definitions.search', 'Search definitions…')}
    searchAriaLabel={t('agent.definitions.search-label', 'Search definitions')}>
    {#snippet cell(c, row)}
      {#if c.column.id === 'name'}
        <a class="break-words text-indigo-600 hover:underline dark:text-indigo-400" href={definitionEntryHref(agentId, row)}>{row.node.name}</a>
      {:else if c.column.id === 'urn'}
        <Urn value={row.node.urn} label={t('agent.definitions.node', 'node')} linked />
      {:else if c.column.id === 'origin'}
        {#if row.node.inheritedFrom}<Urn value={row.node.inheritedFrom.agentUrn} label={t('agent.base.label', 'base Agent')} linked />{:else}<span>—</span>{/if}
      {:else}
        <span class="break-words">{String(c.getValue() ?? '—')}</span>
      {/if}
    {/snippet}
  </DataTable>
{/if}
