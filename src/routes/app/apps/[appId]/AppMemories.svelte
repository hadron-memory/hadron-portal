<script lang="ts">
  import { untrack } from 'svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { t } from '$lib/i18n/t';
  import type { AppMemoryRow } from './app-memories';
  let { memories, showDescription = true }: {
    memories: AppMemoryRow[] | null;
    // false when the rows come from a read with no description (a user-owned App).
    showDescription?: boolean;
  } = $props();
  let search = $state('');
  const columns: PortalColumnDef<AppMemoryRow>[] = [
    { accessorKey: 'name', header: t('app.memory.name', 'Name'), enableHiding: false, size: 260 },
    ...(untrack(() => showDescription) ? [{ accessorKey: 'description', header: t('app.memory.description', 'Description'), size: 360 }] : []),
  ];
  const table = createSvelteTable<AppMemoryRow>({
    get data() { return memories ?? []; }, columns,
    globalFilterFn: makeGlobalFilterFn<AppMemoryRow>({}, { name: row => row.urn }),
    enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return search; } },
    onGlobalFilterChange: u => { search = typeof u === 'function' ? u(search) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>
<section class="mb-6 space-y-4">
  {#if memories === null}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.memory.load-failed', 'Could not load this App’s memories. Reload to try again.')}</p>
  {:else if memories.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.memory.empty', 'No App memories to show.')}</p>
  {:else}
    <DataTable {table} listKey="app-memories" bind:globalFilter={search} searchPlaceholder={t('app.memory.search', 'Search App memories')} searchAriaLabel={t('app.memory.search', 'Search App memories')}>
      {#snippet cell(cell, memory)}
        {#if cell.column.id === 'name'}
          <a href="/app/memories/{memory.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{memory.name}</a>
          <div class="mt-1"><Urn value={memory.urn} type="memory" size={10} /></div>
        {:else}{memory.description?.trim() ? memory.description : '—'}{/if}
      {/snippet}
    </DataTable>
  {/if}
</section>
