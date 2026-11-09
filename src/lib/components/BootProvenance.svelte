<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { onDestroy, tick } from 'svelte';
  import type { ProvenancePage, ProvenanceRow } from '$lib/boot-install';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { nodeId, revision, headingLevel = 3 }: { nodeId: string; revision: number; headingLevel?: 3 | 4 } = $props();
  let page = $state<ProvenancePage | null>(null);
  let failed = $state(false), busy = $state(false), offset = $state(0);
  let epoch = 0;
  let attemptedOffset = 0;
  let region: HTMLDivElement;
  const identity = $derived(`${nodeId}:${revision}`);
  // Three columns, not five: revision and depth read as detail under the source's name, so a phone
  // is not asked to scroll sideways for numbers a reader rarely needs (portal#1757).
  const columns: PortalColumnDef<ProvenanceRow>[] = [
    { accessorKey: 'name', header: t('boot.provenance.name', 'Source'), size: 220 },
    { id: 'selection', header: t('boot.provenance.settings', 'Include settings'), size: 150 },
    { id: 'pruned', header: t('boot.provenance.retention', 'Text kept'), size: 100 },
  ];
  function settingsText(s: ProvenanceRow['selection']) {
    const which = s.rev === null ? t('boot.provenance.latest', 'Latest revision') : t('boot.provenance.pinned', 'Revision {n}', { n: s.rev });
    const only = s.approved && s.signed ? t('boot.provenance.approved-signed', 'Approved and signed only')
      : s.approved ? t('boot.provenance.approved-only', 'Approved only')
      : s.signed ? t('boot.provenance.signed-only', 'Signed only') : '';
    return only ? `${which} · ${only}` : which;
  }
  const table = createSvelteTable<ProvenanceRow>({ get data() { return page?.items ?? []; }, columns, enableColumnResizing: true, columnResizeMode: 'onChange', initialState: { pagination: { pageIndex: 0, pageSize: 20 } } });
  async function load(next: number, retry = false) {
    const stamp = ++epoch, expected = identity;
    busy = true; attemptedOffset = next;
    try {
      const r = await fetch(`/app/boot-prompt?${new URLSearchParams({ node: nodeId, revision: String(revision), offset: String(next) })}`, { signal: AbortSignal.timeout(30_000) });
      const value = await r.json();
      if (epoch !== stamp || identity !== expected) return;
      if (!r.ok || !('page' in value)) throw new Error('failed');
      page = value.page; offset = next; failed = false;
      if (retry) {
        await tick();
        if (epoch === stamp && identity === expected && region?.isConnected) region.focus();
      }
    } catch { if (epoch === stamp && identity === expected) { failed = true; page = null; } }
    finally { if (epoch === stamp && identity === expected) busy = false; }
  }
  $effect(() => { identity; page = null; offset = 0; failed = false; void load(0); });
  onDestroy(() => { ++epoch; });
</script>
<div bind:this={region} tabindex="-1" role="region" aria-label={t('boot.provenance.region', 'Compiled prompt provenance')} aria-busy={busy} class="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
  <div class={failed ? 'space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300' : ''}>
  <p role="alert">{failed ? t('boot.provenance.failed', 'Couldn’t load what this revision was built from.') : ''}</p>
  {#if failed}<button type="button" disabled={busy} class="rounded border border-red-300 px-3 py-1.5 disabled:opacity-50 dark:border-red-700" onclick={() => load(attemptedOffset, true)}>{busy ? t('boot.provenance.retrying', 'Retrying…') : t('boot.provenance.retry', 'Retry')}</button>{/if}
  </div>
  {#if page}
    <section aria-label={t('boot.provenance.title', 'Built from')} class="space-y-2">
      <svelte:element this={`h${headingLevel}`} class="font-semibold">{t("boot.install.a3d5f43902", "Built from")}</svelte:element>
      {#if page.pruned}<p>{t("boot.install.2bb11af10a", "This revision’s text is no longer kept.")}</p>{/if}
      <DataTable {table} listKey="boot-prompt-provenance" searchPlaceholder={t('boot.provenance.search', 'Search this page…')} searchAriaLabel={t('boot.provenance.search-label', 'Search provenance on this page')} showSearch={false} showFooter={false}>
        {#snippet cell(cell, item)}
          {#if cell.column.id === 'name'}
            {#if item.urn && item.name}<span>{item.name}</span> <Urn value={item.urn} type="node" />{:else}{item.omitted ? t('boot.provenance.omitted', 'name not loaded') : t('boot.provenance.unavailable', 'Not available to you')}{/if}
            <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('boot.provenance.detail', 'Revision {n}, depth {d}', { n: item.revNo, d: item.depth })}{item.pruned === true ? ` · ${t('boot.provenance.pruned', 'No longer kept')}` : ''}</div>
          {:else if cell.column.id === 'selection'}
            {settingsText(item.selection)}
          {:else if cell.column.id === 'pruned'}
            {item.pruned === true ? t('boot.provenance.pruned', 'No longer kept') : item.pruned === false ? t('boot.provenance.kept', 'Kept') : ''}
          {:else}{cell.getValue()}{/if}
        {/snippet}
      </DataTable>
      <p>{t('boot.provenance.range', '{start}–{end} of {total}', { start: page.items.length ? offset + 1 : 0, end: offset + page.items.length, total: page.total })}</p>
      <nav class="flex gap-3 text-sm" aria-label={t('boot.provenance.paging', 'Provenance pages')}>
      <button class="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-600" type="button" disabled={busy || offset === 0} onclick={() => load(Math.max(0, offset - 20))}>{t("boot.install.50f94286ba", "Previous")}</button>
      <button class="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-600" type="button" disabled={busy || !page.hasMore} onclick={() => load(offset + 20)}>{t("boot.install.bc981983e7", "Next")}</button>
      </nav>
    </section>
  {/if}
</div>
