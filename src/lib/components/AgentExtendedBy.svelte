<script lang="ts">
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AgentExtensions, AgentIdentity } from '$lib/server/agent-profile';
  import { t } from '$lib/i18n/t';

  let { agentId, result }: { agentId: string; result: AgentExtensions } = $props();
  const baseHref = $derived(`/app/agents/${encodeURIComponent(agentId)}`);
  const columns: PortalColumnDef<AgentIdentity>[] = [
    { accessorKey: 'name', header: t('agent.extended-by.name', 'Name'), size: 220 },
    { accessorKey: 'urn', header: t('agent.extended-by.urn', 'URN'), size: 340 },
  ];
  let filter = $state('');
  const table = createSvelteTable<AgentIdentity>({
    get data() { return result.items; },
    columns,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return filter; } },
    onGlobalFilterChange: u => { filter = typeof u === 'function' ? u(filter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<section class="min-w-0 space-y-3" aria-label={t('agent.extended-by.heading', 'Extended by')}>
  <h2 class="font-semibold">{t('agent.extended-by.heading', 'Extended by')}</h2>
  <p class="text-sm text-zinc-500">{t('agent.extended-by.scope', 'Agents you can read that directly extend this Agent. Search and sorting apply to this page.')}</p>
  {#if result.failed}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('agent.extended-by.failed', 'Could not load extending Agents. Try again from the first page.')}</p>
  {:else if result.items.length === 0}
    <p class="text-sm text-zinc-500">{result.hasMore
      ? t('agent.extended-by.incomplete', 'No readable Agents on this page. Continue to check for more results.')
      : t('agent.extended-by.empty', 'No readable extending Agents on this page.')}</p>
  {/if}
  <DataTable {table} listKey="agent-detail-extended-by" bind:globalFilter={filter} searchAriaLabel={t('agent.extended-by.search-label', 'Search extending Agents on this page')} searchPlaceholder={t('agent.extended-by.search', 'Search this page…')}>
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <a class="text-indigo-600 hover:underline dark:text-indigo-400" href="/app/agents/{encodeURIComponent(row.id)}">{row.name}</a>
        {:else if cell.column.id === 'urn'}
          <Urn value={row.urn} type="agent" linked label={t('agent.extended-by.agent', 'extending Agent')} />
        {/if}
      {/snippet}
  </DataTable>
  <nav class="flex flex-wrap gap-4 text-sm" aria-label={t('agent.extended-by.paging', 'Extending Agents pages')}>
    <a class="text-indigo-600 hover:underline dark:text-indigo-400" href={baseHref} data-sveltekit-reload>{t('agent.extended-by.first', 'First page / retry')}</a>
    {#if !result.failed && result.hasMore && result.endCursor}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href="{baseHref}?extendedAfter={encodeURIComponent(result.endCursor)}">{t('agent.extended-by.next', 'Next page of extending Agents')}</a>
    {/if}
  </nav>
</section>
