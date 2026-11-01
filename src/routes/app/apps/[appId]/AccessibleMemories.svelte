<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AppScopedMemory } from '$lib/app-memory-scope';
  import { t } from '$lib/i18n/t';
  let { rows }: { rows: AppScopedMemory[] | null } = $props();
  let search = $state('');
  function sourceText(row: AppScopedMemory): string {
    return row.sources.map(source => {
      const kind = source.kind === 'AGENT_SYSTEM' ? t('app.memory-scope.agent-system', 'Agent system')
        : source.kind === 'AGENT_LINK' ? t('app.memory-scope.agent-link', 'Agent link')
        : source.kind === 'INHERITED_BASE' ? t('app.memory-scope.inherited', 'Inherited base')
        : source.kind === 'TEAM_SPACE' ? t('app.memory-scope.team-space', 'Team space')
        : source.kind === 'APP_MEMORY' ? t('app.memory-scope.app-memory', 'App memory') : source.kind;
      // Source kinds are sufficient provenance. Never resolve or expose a
      // source Agent identity just because its id appears on a scope leaf.
      return kind;
    }).join(t('app.memory-scope.separator', ', '));
  }
  const columns: PortalColumnDef<AppScopedMemory>[] = [
    { id: 'name', accessorFn: row => `${row.name} ${row.memoryUrn}`, header: t('app.memory.name', 'Name'), enableHiding: false, size: 300 },
    { id: 'sources', accessorFn: sourceText, header: t('app.memory-scope.sources', 'Sources'), size: 280 },
  ];
  const table = createSvelteTable<AppScopedMemory>({
    get data() { return rows ?? []; }, columns,
    globalFilterFn: makeGlobalFilterFn<AppScopedMemory>({}),
    enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return search; } },
    onGlobalFilterChange: update => { search = typeof update === 'function' ? update(search) : update; },
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>
<div class="mt-3">
  {#if rows === null}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.memory-scope.failed', 'Could not load accessible memories. Reload to try again.')}</p>
  {:else if rows.length === 0}
    <p class="text-sm text-zinc-500">{t('app.memory-scope.empty', 'No accessible memories to show.')}</p>
  {:else}
    <DataTable {table} listKey="app-accessible-memories" bind:globalFilter={search} searchPlaceholder={t('app.memory-scope.search', 'Search accessible memories')} searchAriaLabel={t('app.memory-scope.search', 'Search accessible memories')}>
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <span class="font-medium">{row.name}</span>
          <div class="mt-1"><Urn value={row.memoryUrn} type="memory" size={10} /></div>
        {:else}{sourceText(row)}{/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
