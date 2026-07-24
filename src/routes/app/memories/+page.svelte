<script lang="ts">
  // "My memories" — the caller's own (org-less, user-owned) memories — plus a
  // "Memories shared with me" tab listing memories other users shared with the
  // caller via MemoryShare (#778). Both lists use the shared TanStack DataTable.
  import { tick } from 'svelte';
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
  const memories = $derived(data.memories ?? []);
  const loadFailed = $derived(data.loadFailed === true);
  const sharedMemories = $derived(data.sharedMemories ?? []);
  const sharedLoadFailed = $derived(data.sharedLoadFailed === true);

  // ── Tabs (ARIA tab pattern) ──────────────────────────────────────────────
  type TabId = 'mine' | 'shared';
  let activeTab = $state<TabId>('mine');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'mine', label: t('my-memories.tab.mine', 'My memories') },
    { id: 'shared', label: t('my-memories.tab.shared', 'Memories shared with me') },
  ];
  async function focusTab(id: TabId) {
    activeTab = id;
    await tick();
    document.getElementById(`tab-${id}`)?.focus();
  }
  function onTabKeydown(e: KeyboardEvent) {
    const order = tabs.map((tt) => tt.id);
    const i = order.indexOf(activeTab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusTab(order[(i + 1) % order.length]); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusTab(order[(i - 1 + order.length) % order.length]); }
    else if (e.key === 'Home') { e.preventDefault(); focusTab(order[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusTab(order[order.length - 1]); }
  }

  const roleLabel = (role: 'reader' | 'writer'): string =>
    role === 'writer'
      ? t('my-memories.shared.role.writer', 'Can edit')
      : t('my-memories.shared.role.reader', 'Read only');
  const classLabel = (cls: string): string =>
    cls === 'private'
      ? t('my-memories.badge.private', 'Private')
      : t('my-memories.badge.personal', 'Personal');
  const grantorLabel = (grantor: { handle: string | null; name: string | null }): string =>
    grantor.handle
      ? `@${grantor.handle}`
      : (grantor.name ?? t('my-memories.shared.grantor-unknown', 'someone'));

  const NAME_COL = () => t('my-memories.col.name', 'Name');
  const tableMaxHeight = 'max(200px, calc(100vh - 21rem))';

  // ── My memories table ────────────────────────────────────────────────────
  interface MyMemoryRow { id: string; name: string; urn: string; class: string }
  const myRows = $derived<MyMemoryRow[]>(
    memories.map((m) => ({ id: m.id, name: m.name, urn: m.urn, class: m.class ?? '' })),
  );
  let mineFilter = $state('');
  const myColumns: ColumnDef<MyMemoryRow>[] = [
    { accessorKey: 'name', header: NAME_COL(), enableHiding: false, size: 320 },
    { accessorKey: 'urn', header: 'URN', size: 320 },
    { accessorKey: 'class', id: 'kind', header: t('my-memories.col.kind', 'Kind'), size: 120 },
  ];
  const myTable = createSvelteTable<MyMemoryRow>({
    get data() { return myRows; },
    columns: myColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return mineFilter; } },
    onGlobalFilterChange: (u) => { mineFilter = typeof u === 'function' ? u(mineFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // ── Memories shared with me table ────────────────────────────────────────
  interface SharedRow { id: string; name: string; urn: string; sharedBy: string; role: 'reader' | 'writer' | '' }
  const sharedRows = $derived<SharedRow[]>(
    sharedMemories.map((m) => ({
      id: m.id,
      name: m.name,
      urn: m.urn,
      sharedBy: m.myShare ? grantorLabel(m.myShare.grantor) : '',
      role: m.myShare?.role ?? '',
    })),
  );
  let sharedFilter = $state('');
  const sharedColumns: ColumnDef<SharedRow>[] = [
    { accessorKey: 'name', header: NAME_COL(), enableHiding: false, size: 260 },
    { accessorKey: 'urn', header: 'URN', size: 260 },
    { accessorKey: 'sharedBy', id: 'sharedBy', header: t('my-memories.col.shared-by', 'Shared by'), size: 160 },
    { accessorKey: 'role', id: 'access', header: t('my-memories.col.access', 'Access'), size: 120 },
  ];
  const sharedTable = createSvelteTable<SharedRow>({
    get data() { return sharedRows; },
    columns: sharedColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return sharedFilter; } },
    onGlobalFilterChange: (u) => { sharedFilter = typeof u === 'function' ? u(sharedFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
</script>

<svelte:head><title>{t('my-memories.title', 'My memories — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-memories.heading', 'My memories')}</h1>
    <a
      href="/app/memories/new"
      class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >{t('my-memories.new', 'New memory')}</a>
  </div>

  <!-- Tabs (ARIA tab pattern) -->
  <div role="tablist" aria-label={t('my-memories.tabs-label', 'Memories')} class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id="tab-{tab.id}"
        aria-selected={activeTab === tab.id}
        aria-controls="panel-{tab.id}"
        tabindex={activeTab === tab.id ? 0 : -1}
        onclick={() => (activeTab = tab.id)}
        onkeydown={onTabKeydown}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >
        {tab.label}
        {#if tab.id === 'shared' && sharedRows.length > 0}
          <span class="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{sharedRows.length}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- My memories panel -->
  {#if activeTab === 'mine'}
    <div id="panel-mine" role="tabpanel" aria-labelledby="tab-mine" tabindex="0" class="space-y-3 focus:outline-none">
      {#if loadFailed}
        <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('my-memories.load-failed', "Couldn't load your memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
        </div>
      {:else if myRows.length === 0}
        <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.empty', "You don't have any memories yet.")}</p>
          <a href="/app/memories/new" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('my-memories.empty-cta', 'Create your first memory')}</a>
        </div>
      {:else}
        <DataTable
          table={myTable}
          listKey="memories:mine"
          searchPlaceholder={t('my-memories.search', 'Search memories…')}
          searchAriaLabel={t('my-memories.search', 'Search memories…')}
          bind:globalFilter={mineFilter}
          maxHeight={tableMaxHeight}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'name'}
              <a href="/app/memories/{row.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
            {:else if cell.column.id === 'urn'}
              <Urn value={row.urn} type="memory" size={10} />
            {:else if cell.column.id === 'kind'}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{classLabel(row.class)}</span>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
  {/if}

  <!-- Memories shared with me panel -->
  {#if activeTab === 'shared'}
    <div id="panel-shared" role="tabpanel" aria-labelledby="tab-shared" tabindex="0" class="space-y-3 focus:outline-none">
      {#if sharedLoadFailed}
        <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('my-memories.shared.load-failed', "Couldn't load memories shared with you just now — this is a temporary error, not an empty list. Try refreshing the page.")}
        </div>
      {:else if sharedRows.length === 0}
        <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.shared.empty', 'No one has shared a memory with you yet.')}</p>
        </div>
      {:else}
        <DataTable
          table={sharedTable}
          listKey="memories:shared"
          searchPlaceholder={t('my-memories.shared.search', 'Search shared memories…')}
          searchAriaLabel={t('my-memories.shared.search', 'Search shared memories…')}
          bind:globalFilter={sharedFilter}
          maxHeight={tableMaxHeight}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'name'}
              <a href="/app/memories/{row.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
            {:else if cell.column.id === 'urn'}
              <Urn value={row.urn} type="memory" size={10} />
            {:else if cell.column.id === 'sharedBy'}
              <span class="text-zinc-700 dark:text-zinc-300">{row.sharedBy}</span>
            {:else if cell.column.id === 'access'}
              {#if row.role === 'reader' || row.role === 'writer'}
                <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{roleLabel(row.role)}</span>
              {/if}
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
  {/if}
</div>
