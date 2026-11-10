<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { PublicResourceRef } from '$lib/types';
  import { encodeUrnPathSegment } from '$lib/urn/encode-urn-segment';

  let {
    resources,
    kind,
    listKey,
  }: {
    resources: PublicResourceRef[];
    kind: 'memory' | 'agent';
    listKey: string;
  } = $props();

  const rows = $derived(resources);
  const heading = $derived(kind === 'memory'
    ? t('public-organization.resources.memories', 'public memories')
    : t('public-organization.resources.agents', 'public agents'));
  const search = $derived(t('public-organization.resources.search', 'Search {resources}…', { resources: heading }));
  let globalFilter = $state('');

  const columns: PortalColumnDef<PublicResourceRef>[] = [
    {
      id: 'name',
      // Everything rendered in the identity cell stays searchable: the name,
      // the full URN, and the type text inside the shared URN chip.
      accessorFn: (row) => `${row.name} ${row.urn}`,
      header: t('public-organization.resources.name', 'Name'),
      enableHiding: false,
      size: 120,
    },
    {
      id: 'description',
      accessorFn: (row) => row.description ?? '—',
      header: t('public-organization.resources.description', 'Description'),
      size: 100,
    },
  ];

  const table = createSvelteTable<PublicResourceRef>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (update) => {
      globalFilter = typeof update === 'function' ? update(globalFilter) : update;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

{#if rows.length === 0}
  <div
    data-testid={kind === 'memory' ? 'public-memories-empty' : 'public-agents-empty'}
    class="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
  >
    {t('public-organization.resources.empty', 'No {resources} yet.', { resources: heading })}
  </div>
{:else}
  <DataTable
    {table}
    {listKey}
    searchPlaceholder={search}
    searchAriaLabel={search}
    bind:globalFilter
    maxHeight="max(200px, calc(100vh - 24rem))"
  >
    {#snippet cell(cell, row)}
      {#if cell.column.id === 'name'}
        <div class="min-w-0">
          <a
            href="/app/u/{encodeUrnPathSegment(row.urn)}"
            title={row.name}
            class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300"
          >{row.name}</a>
          <div class="mt-1 flex min-w-0">
            <Urn value={row.urn} type={kind} compact copyUrl={false} label={row.name} />
          </div>
        </div>
      {:else}
        <div class="break-words text-xs sm:text-sm">{row.description ?? '—'}</div>
      {/if}
    {/snippet}
  </DataTable>
{/if}
