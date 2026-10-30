<script lang="ts">
  import { parseSyncReport, syncReportSummary, type SyncOutcomeFields, type SyncReportEntry } from '$lib/sync-report';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { t } from '$lib/i18n/t';

  let { lastSyncReport, syncStatus, lastSyncedAt, listKey = 'sync-report:outcomes' }: SyncOutcomeFields & { listKey?: string } = $props();
  const view = $derived(parseSyncReport(lastSyncReport, syncStatus, lastSyncedAt));
  let globalFilter = $state('');
  const columns: PortalColumnDef<SyncReportEntry>[] = [
    { accessorKey: 'kind', header: t('sync-report.kind', 'Kind'), size: 180 },
    { accessorKey: 'loc', header: t('sync-report.loc', 'Source location'), size: 280 },
    { accessorKey: 'fromLoc', header: t('sync-report.from-loc', 'Moved from'), size: 240 },
    { accessorKey: 'code', header: t('sync-report.code', 'Code'), size: 230 },
  ];
  const table = createSvelteTable<SyncReportEntry>({
    get data() { return view.entries; }, columns,
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: u => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    enableColumnResizing: true, columnResizeMode: 'onChange',
  });
</script>

<div class="min-w-0 px-5 py-3 text-sm text-zinc-700 dark:text-zinc-300">
  <p class="font-medium">{t('sync-report.heading', 'Last recorded outcome')}</p>
  {#if view.recordedAt}<time datetime={view.recordedAt} class="text-xs text-zinc-500">{view.recordedAt}</time>{/if}
  <p>{lastSyncReport === null && !lastSyncedAt ? t('sync-report.never-synced', 'Not synced yet.') : syncReportSummary(view)}</p>
  {#if view.code}<p class="font-mono text-xs">{view.code}</p>{/if}
  {#if view.entries.length}
    <DataTable {table} {listKey} bind:globalFilter
      maxHeight="max(160px, 40vh)"
      searchPlaceholder={t('sync-report.search', 'Search recorded outcomes…')}
      searchAriaLabel={t('sync-report.search-aria', 'Search recorded sync outcomes')}>
      {#snippet cell(c)}<span class="break-all text-xs">{String(c.getValue() ?? '—')}</span>{/snippet}
    </DataTable>
  {/if}
</div>
