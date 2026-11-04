<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { onDestroy } from 'svelte';
  import type { ProvenancePage, ProvenanceRow } from '$lib/boot-install';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { nodeId, revision }: { nodeId: string; revision: number } = $props();
  let page = $state<ProvenancePage | null>(null);
  let failed = $state(false), busy = $state(false), offset = $state(0);
  let epoch = 0;
  const identity = $derived(`${nodeId}:${revision}`);
  const columns: PortalColumnDef<ProvenanceRow>[] = [
    { accessorKey: 'name', header: t('boot.provenance.name', 'Source'), size: 300 },
    { accessorKey: 'depth', header: t('boot.provenance.depth', 'Depth'), size: 80 },
    { accessorKey: 'revNo', header: t('boot.provenance.revision', 'Revision'), size: 100 },
    { id: 'selection', header: t('boot.provenance.settings', 'Include settings'), size: 230 },
    { id: 'pruned', header: t('boot.provenance.retention', 'Retention'), size: 220 },
  ];
  const table = createSvelteTable<ProvenanceRow>({ get data() { return page?.items ?? []; }, columns, enableColumnResizing: true, columnResizeMode: 'onChange', initialState: { pagination: { pageIndex: 0, pageSize: 20 } } });
  async function load(next: number) {
    const stamp = ++epoch, expected = identity;
    busy = true; failed = false;
    try {
      const r = await fetch(`/app/boot-prompt?${new URLSearchParams({ node: nodeId, revision: String(revision), offset: String(next) })}`, { signal: AbortSignal.timeout(30_000) });
      const value = await r.json();
      if (epoch !== stamp || identity !== expected) return;
      if (!r.ok || !('page' in value)) throw new Error('failed');
      page = value.page; offset = next;
    } catch { if (epoch === stamp && identity === expected) { failed = true; page = null; } }
    finally { if (epoch === stamp && identity === expected) busy = false; }
  }
  $effect(() => { identity; page = null; offset = 0; void load(0); });
  onDestroy(() => { ++epoch; });
</script>
<div aria-busy={busy}>
  <p role="alert">{failed ? t('boot.provenance.failed', 'Couldn’t load what this revision was built from.') : ''}</p>
  {#if page}
    <section aria-label={t('boot.provenance.title', 'Built from')} class="space-y-2">
      <h3 class="font-semibold">{t("boot.install.a3d5f43902", "Built from")}</h3>
      {#if page.pruned}<p>{t("boot.install.2bb11af10a", "This revision’s text is no longer kept.")}</p>{/if}
      <DataTable {table} listKey="boot-prompt-provenance" searchPlaceholder="Search this page…" searchAriaLabel="Search provenance on this page" showSearch={false} showFooter={false}>
        {#snippet cell(cell, item)}
          {#if cell.column.id === 'name'}
            {#if item.urn && item.name}<span>{item.name}</span> <Urn value={item.urn} type="node" />{:else}{item.omitted ? t('boot.provenance.omitted', 'name not loaded') : t('boot.provenance.unavailable', 'Not available to you')}{/if}
          {:else if cell.column.id === 'selection'}
            {t('boot.provenance.selection', 'rev: {rev}; approved: {approved}; signed: {signed}', { rev: item.selection.rev ?? t('boot.provenance.latest', 'latest'), approved: String(item.selection.approved), signed: String(item.selection.signed) })}
          {:else if cell.column.id === 'pruned'}
            {item.pruned === true ? t('boot.provenance.pruned', 'This revision’s text is no longer kept.') : ''}
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
