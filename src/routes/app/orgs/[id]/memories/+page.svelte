<!--
  Org memories list — TanStack grid (@tanstack/table-core + the Svelte 5
  runes adapter, src/lib/table/*), same chrome conventions as
  /app/usage/sessions and /app/account/api-keys (PR #293/#294).

  The four former card sections (org memories, private/personal, system,
  subscribed) are merged into ONE grid with a Type badge column; subscribed
  rows carry the source org in the "From" column. Per-row actions vary by
  section: Edit (all), Delete (org), Unsubscribe (subscribed).
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  type Section = 'org' | 'private' | 'system' | 'subscribed';

  interface MemoryRow {
    id: string; // memory id — nav target and delete/unsubscribe payload
    name: string;
    urn: string;
    section: Section;
    /** Badge text: visibility (org), Private/Personal, system, or the
     *  subscription role — what the colored chip rendered per-section
     *  in the old card layout. */
    badge: string;
    storage: string | null; // git-backed / DB-only (org rows only)
    branch: string | null;
    lastSyncedAt: string | null;
    fromOrg: string | null; // subscribed rows: source org name
  }

  const rows = $derived<MemoryRow[]>([
    ...(org.memories ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      urn: g.urn,
      section: 'org' as const,
      badge: g.visibility ?? '—',
      storage: g.source ? 'git-backed' : 'DB-only',
      branch: g.readBranch,
      lastSyncedAt: g.lastSyncedAt,
      fromOrg: null,
    })),
    ...(data.privateMemories ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      urn: g.urn,
      section: 'private' as const,
      badge: g.class === 'private' ? 'Private' : 'Personal',
      storage: null,
      branch: null,
      lastSyncedAt: null,
      fromOrg: null,
    })),
    ...(data.systemMemories ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      urn: g.urn,
      section: 'system' as const,
      badge: 'system',
      storage: null,
      branch: null,
      lastSyncedAt: null,
      fromOrg: null,
    })),
    ...(org.subscriptions ?? []).map((s) => ({
      id: s.memory.id,
      name: s.memory.name,
      urn: s.memory.urn,
      section: 'subscribed' as const,
      badge: s.role,
      storage: null,
      branch: null,
      lastSyncedAt: null,
      fromOrg: s.memory.organization?.name ?? 'unknown',
    })),
  ]);

  // Badge chip colors — preserves the per-section palette of the old
  // card layout (visibility green/zinc, private amber, system purple,
  // subscription role blue).
  function badgeClass(row: MemoryRow): string {
    if (row.section === 'private') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    if (row.section === 'system') return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    if (row.section === 'subscribed') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    return row.badge === 'PUBLIC'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  }

  function formatDate(val: string | null): string {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let globalFilter = $state('');

  const columns: ColumnDef<MemoryRow>[] = [
    { accessorKey: 'name', header: t('org-memories.column.name', 'Name'), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: t('org-memories.column.urn', 'URN'), size: 280 },
    { accessorKey: 'badge', id: 'type', header: t('org-memories.column.type', 'Type'), size: 110 },
    { accessorKey: 'storage', header: t('org-memories.column.storage', 'Storage'), size: 100 },
    { accessorKey: 'branch', header: t('org-memories.column.branch', 'Branch'), size: 100 },
    { accessorKey: 'lastSyncedAt', header: t('org-memories.column.last-synced', 'Last synced'), size: 120 },
    { accessorKey: 'fromOrg', header: t('org-memories.column.from', 'From'), size: 140 },
    { id: 'actions', header: t('org-memories.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 140 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    storage: (v) => (v as string | null) ?? '—',
    branch: (v) => (v as string | null) ?? '—',
    lastSyncedAt: (v) => formatDate(v as string | null),
    fromOrg: (v) => (v as string | null) ?? '—',
  };

  const table = createSvelteTable<MemoryRow>({
    get data() {
      return rows;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });


</script>

<svelte:head><title>Memories · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb + header -->
  <div class="flex items-center justify-between">
    <div>
      <Breadcrumb items={[
        { label: 'Memories' },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{org.name}'s Memories</h1>
    </div>
    <div class="flex items-center gap-3">
      <form method="POST" action="?/syncAll" use:enhance>
        <button type="submit" class="cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          Sync all
        </button>
      </form>
      <a href="/app/orgs/{org.id}/memories/new" class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
        + Add memory
      </a>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.synced}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">All memories synced.</div>
  {/if}
  {#if form?.subscribed}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Subscribed to memory.</div>
  {/if}

  {#if rows.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No memories yet. <a href="/app/orgs/{org.id}/memories/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Add one →</a>
    </div>
  {:else}
    <!-- 28rem offset tuned to this page's chrome height (header buttons,
         banners, subscribe form below) — per-page convention. -->
    <DataTable
      {table}
      listKey="orgs:memories"
      searchPlaceholder={t('org-memories.search.placeholder', 'Search memories...')}
      searchAriaLabel={t('org-memories.search.aria-label', 'Search memories')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 28rem))"
    >
      {#snippet cell(cell, m)}
        {#if cell.column.id === 'name'}
          <div class="truncate">
            <a href="/app/memories/{m.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
          </div>
        {:else if cell.column.id === 'urn'}
          <Urn value={m.urn} type="memory" size={10} />
        {:else if cell.column.id === 'type'}
          <span class="inline-block rounded px-1.5 py-0.5 text-xs {badgeClass(m)}">{m.badge}</span>
        {:else if cell.column.id === 'actions'}
          <div class="flex items-center gap-3">
            <a href="/app/memories/{m.id}" class="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">Edit</a>
            {#if m.section === 'org'}
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm(`Delete "${m.name}"?`)) e.preventDefault(); }}>
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" class="text-red-400 hover:text-red-300">Delete</button>
              </form>
            {:else if m.section === 'subscribed'}
              <form method="POST" action="?/unsubscribe" use:enhance onsubmit={(e) => { if (!confirm(`Unsubscribe from "${m.name}"?`)) e.preventDefault(); }}>
                <input type="hidden" name="memoryId" value={m.id} />
                <button type="submit" class="text-red-400 hover:text-red-300">Unsubscribe</button>
              </form>
            {/if}
          </div>
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  <!-- Subscribe to external memories -->
  <div>
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Subscribe to a memory</h2>
    {#if data.availableMemories.length === 0}
      <p class="text-sm text-zinc-500">No public memories available to subscribe to.</p>
    {:else}
      <form method="POST" action="?/subscribe" use:enhance class="flex items-end gap-3 max-w-lg">
        <div class="flex-1">
          <label for="memoryId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Public memory</label>
          <select id="memoryId" name="memoryId" required class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="">Select a memory...</option>
            {#each data.availableMemories as m (m.id)}
              <option value={m.id}>{m.name} ({m.urn})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="subRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Subscribe</button>
      </form>
    {/if}
  </div>
</div>
