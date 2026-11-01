<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AgentExtensions, AgentIdentity } from '$lib/server/agent-profile';
  import { t } from '$lib/i18n/t';

  let { agentId, result, requestedAfter = null }: { agentId: string; result: AgentExtensions; requestedAfter?: string | null } = $props();
  const baseHref = $derived(`/app/agents/${encodeURIComponent(agentId)}`);
  const firstHref = $derived(`${baseHref}#extended-by`);
  const retryHref = $derived(requestedAfter === null ? baseHref : `${baseHref}?extendedAfter=${encodeURIComponent(requestedAfter)}`);
  let section: HTMLElement;
  let retrying = $state(false);
  const retryingLabel = t('agent.extended-by.retrying', 'Retrying…');
  const failedText = $derived(!result.failed || retrying ? '' : requestedAfter === null
    ? t('agent.extended-by.failed-first', 'Could not load extending Agents. Retry this page.')
    : t('agent.extended-by.failed', 'Could not load extending Agents. Retry this page, or return to the first page.'));
  async function retry(event: MouseEvent) {
    // Modified links retain native tab/window/download behavior, even while a
    // plain retry is pending. Browsers deliver middle clicks through auxclick.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (retrying) return;
    retrying = true;
    try {
      await invalidateAll();
    } catch {
      // Keep the existing failed-read feedback if the route itself cannot reload.
    } finally {
      retrying = false;
      if (section?.isConnected) section.focus();
    }
  }
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
  // Parent prop getters can depend on the whole refreshed loader object.
  // A derived primitive compares equal on same-page refreshes before the reset runs.
  const pageIdentity = $derived(JSON.stringify([agentId, requestedAfter]));
  $effect(() => {
    pageIdentity;
    untrack(() => { filter = ''; table.setPageIndex(0); });
  });
</script>

<section bind:this={section} id="extended-by" tabindex="-1" class="min-w-0 space-y-3" aria-labelledby="extended-by-heading">
  <h2 id="extended-by-heading" class="font-semibold">{t('agent.extended-by.heading', 'Extended by')}</h2>
  <!-- #1311: the status and the alert are mounted before any retry, so assistive
       technology is already watching them, and they share one wrapper so an
       empty alert adds no gap. The alert empties while a retry is pending and
       refills if the retry fails again: an identical failure is announced anew
       without remounting the table. -->
  <div>
    <p class="text-sm text-zinc-500">{t('agent.extended-by.scope', 'Agents you can read that directly extend this Agent. Search and sorting apply to this server page. Search resets when you change server pages.')}</p>
    <p id="extended-by-alert" role="alert" class={failedText ? 'mt-3 text-sm text-red-600 dark:text-red-400' : 'text-sm text-red-600 dark:text-red-400'}>{failedText}</p>
    <p id="extended-by-status" role="status" class="sr-only">{retrying ? retryingLabel : ''}</p>
  </div>
  <!-- A failed read is never "no extending Agents": its words are in the alert above. -->
  {#if !result.failed && result.items.length === 0}
    <p class="text-sm text-zinc-500">{result.hasMore
      ? t('agent.extended-by.incomplete', 'No readable Agents on this page. Continue to check for more results.')
      : requestedAfter === null
        ? t('agent.extended-by.empty-first', 'No Agents you can read extend this Agent.')
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
    {#if result.failed}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href={retryHref} data-sveltekit-reload onclick={retry} aria-disabled={retrying}>{retrying ? retryingLabel : t('agent.extended-by.retry', 'Retry')}</a>
    {/if}
    {#if requestedAfter !== null}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href={firstHref}>{t('agent.extended-by.first', 'First page')}</a>
    {/if}
    {#if !result.failed && result.hasMore && result.endCursor}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href="{baseHref}?extendedAfter={encodeURIComponent(result.endCursor)}#extended-by">{t('agent.extended-by.next', 'Next 20 extending Agents')}</a>
    {/if}
  </nav>
</section>
