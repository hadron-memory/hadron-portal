<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { PublicResourceRefsPage } from '$lib/types';
  import { encodeUrnPathSegment } from '$lib/urn/encode-urn-segment';

  let {
    page,
    offset,
    prevHref,
    nextHref,
    firstHref,
    kind,
    listKey,
  }: {
    page: PublicResourceRefsPage;
    offset: number;
    prevHref: string | null;
    nextHref: string | null;
    firstHref: string | null;
    kind: 'memory' | 'agent';
    listKey: string;
  } = $props();

  const heading = $derived(kind === 'memory'
    ? t('public-organization.resources.memories', 'public memories')
    : t('public-organization.resources.agents', 'public agents'));

  const columns: PortalColumnDef<PublicResourceRefsPage['items'][number]>[] = [
    {
      id: 'name',
      accessorFn: (row) => `${row.name} ${row.urn}`,
      header: t('public-organization.resources.name', 'Name'),
      enableHiding: false,
      enableSorting: false,
      size: 120,
    },
    {
      id: 'description',
      accessorFn: (row) => row.description ?? '—',
      header: t('public-organization.resources.description', 'Description'),
      enableSorting: false,
      size: 100,
    },
  ];

  // This is ONE server page in server (name, id) order. Manual row models are
  // essential: an old saved view may still carry filter/sort/page-size values,
  // but none of them may hide, reorder, or slice the rows the server returned.
  const table = createSvelteTable<PublicResourceRefsPage['items'][number]>({
    get data() { return page.items; },
    columns,
    getRowId: (row) => row.urn,
    enableSorting: false,
    enableFilters: false,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    initialState: { pagination: { pageIndex: 0, pageSize: 200 } },
  });
</script>

{#if page.items.length === 0}
  <div
    data-testid={kind === 'memory' ? 'public-memories-empty' : 'public-agents-empty'}
    class="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
  >
    {#if offset > 0}
      {t('public-organization.resources.empty-page', 'This page is empty.')}
    {:else}
      {t('public-organization.resources.empty', 'No {resources} yet.', { resources: heading })}
    {/if}
  </div>
{:else}
  <DataTable
    {table}
    {listKey}
    showSearch={false}
    showFooter={false}
    searchPlaceholder=""
    searchAriaLabel=""
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

{#if page.items.length > 0 || offset > 0}
  <nav
    aria-label={t('public-organization.resources.paging', 'Pages of {resources}', { resources: heading })}
    class="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400"
    data-testid={kind === 'memory' ? 'public-memories-paging' : 'public-agents-paging'}
  >
    <span>
      {#if page.items.length > 0}
        {t('public-organization.resources.range', 'Showing {from}–{to} of {total}', {
          from: offset + 1,
          to: offset + page.items.length,
          total: page.total,
        })}
      {:else}
        {t('public-organization.resources.total', '{total} {resources} in all', { total: page.total, resources: heading })}
      {/if}
    </span>
    <span class="flex flex-wrap gap-2">
      {#if firstHref !== null && page.items.length === 0}
        <a href={firstHref} rel="first" class="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-indigo-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-indigo-300 dark:hover:bg-zinc-800">{t('public-organization.resources.first', 'First')}</a>
      {/if}
      {#if prevHref !== null}
        <a href={prevHref} rel="prev" class="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-indigo-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-indigo-300 dark:hover:bg-zinc-800">{t('public-organization.resources.previous', 'Previous')}</a>
      {/if}
      {#if nextHref !== null && page.items.length > 0}
        <a href={nextHref} rel="next" class="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-indigo-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-indigo-300 dark:hover:bg-zinc-800">{t('public-organization.resources.next', 'Next')}</a>
      {/if}
    </span>
  </nav>
{/if}
