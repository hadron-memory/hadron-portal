<script lang="ts">
  // #647: "My apps" — the caller's own (org-less, user-owned) apps. Uses the
  // shared TanStack DataTable, mirroring the /app/agents "My agents" list.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const apps = $derived(data.apps ?? []);
  const loadFailed = $derived(data.loadFailed === true);

  interface AppRow {
    id: string;
    name: string;
    urn: string;
    appType: string;
    agent: string;
    description: string;
  }
  const rows = $derived<AppRow[]>(
    apps.map((a) => ({
      id: a.id,
      name: a.name,
      urn: a.urn,
      appType: a.appType,
      agent: a.agent?.name ?? '',
      description: a.description ?? '',
    })),
  );

  let globalFilter = $state('');
  const columns: ColumnDef<AppRow>[] = [
    { accessorKey: 'name', header: t('my-apps.col.name', 'Name'), enableHiding: false, size: 220 },
    { accessorKey: 'urn', header: 'URN', size: 300 },
    { accessorKey: 'appType', id: 'type', header: t('my-apps.col.type', 'Type'), size: 130 },
    { accessorKey: 'agent', id: 'agent', header: t('my-apps.col.agent', 'Agent'), size: 200 },
    { accessorKey: 'description', header: t('my-apps.col.description', 'Description'), size: 260 },
  ];
  const table = createSvelteTable<AppRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
</script>

<svelte:head><title>{t('my-apps.title', 'My apps — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-apps.heading', 'My apps')}</h1>
      <p class="text-sm text-zinc-500">{t('my-apps.subhead', 'Apps you own directly, outside any organization.')}</p>
    </div>
    <!-- #648: the app name links to the canonical org-optional /app/apps/[appId]
         detail. The "New app" affordance is still omitted until the org-less
         create/install flow lands (tracked in #648). -->
  </div>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('my-apps.load-failed', "Couldn't load your apps just now — this is a temporary error, not an empty list. Try refreshing the page.")}
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-apps.empty', "You don't have any personal apps yet.")}</p>
    </div>
  {:else}
    <DataTable
      {table}
      listKey="apps:mine"
      searchPlaceholder={t('my-apps.search', 'Search apps…')}
      searchAriaLabel={t('my-apps.search', 'Search apps…')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 21rem))"
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <a href="/app/apps/{row.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
        {:else if cell.column.id === 'urn'}
          <Urn value={row.urn} type="app" size={8} />
        {:else if cell.column.id === 'agent'}
          <div class="truncate">{row.agent || '—'}</div>
        {:else if cell.column.id === 'description'}
          <div class="truncate">{row.description || '—'}</div>
        {:else}
          <div class="truncate">{cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
