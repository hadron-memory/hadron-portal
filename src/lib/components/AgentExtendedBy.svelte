<script lang="ts">
  import { untrack } from 'svelte';
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
  // #1503: the section-owned re-read behind Retry. Retry must not re-run the
  // page's loaders (invalidateAll): SvelteKit turns a failed __data.json into
  // the root error page rendered over the Agent page, and the call resolves
  // instead of rejecting, so no catch could ever run. This endpoint answers
  // with the same AgentExtensions the page loader produces.
  const retrySrc = $derived(requestedAfter === null ? `${baseHref}/extended-by` : `${baseHref}/extended-by?after=${encodeURIComponent(requestedAfter)}`);
  let section: HTMLElement;
  let retrying = $state(false);
  const retryingLabel = t('agent.extended-by.retrying', 'Retrying…');
  // #1503: the section renders a working copy. Retry swaps it from the
  // section's own endpoint; a loader-produced replacement of the `result` prop
  // (Next/First navigation, a parent refresh) supersedes any local retry.
  // The initial capture is deliberate; the effect below carries every later
  // prop replacement. Same pattern as BootPromptPointer.
  // svelte-ignore state_referenced_locally
  let view = $state(result);
  $effect(() => { view = result; });
  const failedText = $derived(!view.failed || retrying ? '' : requestedAfter === null
    ? t('agent.extended-by.failed-first', 'Could not load extending Agents. Retry this page.')
    : t('agent.extended-by.failed', 'Could not load extending Agents. Retry this page, or return to the first page.'));
  // Refuse a malformed payload before rendering it: anything that is not a
  // well-formed AgentExtensions is a failed read, never partial garbage.
  function parseExtensions(payload: unknown): AgentExtensions | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (!Array.isArray(p.items)
      || !p.items.every((it): it is AgentIdentity =>
        typeof it === 'object' && it !== null
        && typeof (it as Record<string, unknown>).id === 'string'
        && typeof (it as Record<string, unknown>).name === 'string'
        && typeof (it as Record<string, unknown>).urn === 'string')
      || typeof p.hasMore !== 'boolean'
      || (p.endCursor !== null && typeof p.endCursor !== 'string')
      || typeof p.failed !== 'boolean') return null;
    return { items: p.items, endCursor: p.endCursor as string | null, hasMore: p.hasMore, failed: p.failed };
  }
  async function retry(event: MouseEvent) {
    // Modified links retain native tab/window/download behavior, even while a
    // plain retry is pending. Browsers deliver middle clicks through auxclick.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (retrying) return;
    retrying = true;
    try {
      const response = await fetch(retrySrc, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`extended-by reload failed (${response.status})`);
      const fresh = parseExtensions(await response.json());
      if (!fresh) throw new Error('extended-by reload returned a malformed payload');
      if (section?.isConnected) view = fresh;
    } catch {
      // Keep the failed-read alert; the page and its URL are untouched.
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
    get data() { return view.items; },
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
  {#if !view.failed && view.items.length === 0}
    <p class="text-sm text-zinc-500">{view.hasMore
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
    {#if view.failed}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href={retryHref} data-sveltekit-reload onclick={retry} aria-disabled={retrying}>{retrying ? retryingLabel : t('agent.extended-by.retry', 'Retry')}</a>
    {/if}
    {#if requestedAfter !== null}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href={firstHref}>{t('agent.extended-by.first', 'First page')}</a>
    {/if}
    {#if !view.failed && view.hasMore && view.endCursor}
      <a class="text-indigo-600 hover:underline dark:text-indigo-400" href="{baseHref}?extendedAfter={encodeURIComponent(view.endCursor)}#extended-by">{t('agent.extended-by.next', 'Next 20 extending Agents')}</a>
    {/if}
  </nav>
</section>
