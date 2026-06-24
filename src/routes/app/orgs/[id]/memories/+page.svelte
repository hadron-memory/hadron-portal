<!--
  Org memories — TanStack grid (@tanstack/table-core + the Svelte 5 runes
  adapter, src/lib/table/*), same chrome conventions as /app/usage/sessions
  and /app/account/api-keys (PR #293/#294).

  #342: a secondary tab row splits the view into "Org Memories" (org +
  private/personal + system memories, in the grid) and "Subscriptions" (the
  memories this org subscribes to, plus the subscribe form). #341: Storage,
  Branch and Last-synced are hidden in the default column view (still
  toggleable via the column menu).
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
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  // #342: secondary tab — Org Memories vs Subscriptions.
  let subTab = $state<'org' | 'subscriptions'>('org');
  const subscriptions = $derived(org.subscriptions ?? []);

  // Subscribe form: the memory <select> is replaced by the SelectMemory modal
  // picker (searchable, paginated) — same pattern as the agent detail page.
  let subscribeMemoryOpen = $state(false);
  let selectedSubscribeMemoryId = $state('');
  const selectedSubscribeMemory = $derived(
    data.availableMemories.find((m) => m.id === selectedSubscribeMemoryId),
  );

  type Section = 'org' | 'private' | 'system';

  interface MemoryRow {
    id: string; // memory id — nav target and delete payload
    name: string;
    urn: string;
    section: Section;
    /** Badge text: visibility (org), Private/Personal, or system — the colored
     *  chip that rendered per-section in the old card layout. */
    badge: string;
    storage: string | null; // git-backed / DB-only (org rows only)
    branch: string | null;
    lastSyncedAt: string | null;
  }

  // #342: subscribed memories moved to their own sub-tab, so the grid carries
  // only org + private/personal + system memories.
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
    })),
  ]);

  // Badge chip colors — preserves the per-section palette of the old card
  // layout (visibility green/zinc, private amber, system purple).
  function badgeClass(row: MemoryRow): string {
    if (row.section === 'private') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    if (row.section === 'system') return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
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
    { id: 'actions', header: t('org-memories.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 140 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    storage: (v) => (v as string | null) ?? '—',
    branch: (v) => (v as string | null) ?? '—',
    lastSyncedAt: (v) => formatDate(v as string | null),
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
    // #341: Storage / Branch / Last-synced hidden in the default view (still
    // available via the column menu, and preserved by user-saved views).
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      columnVisibility: { storage: false, branch: false, lastSyncedAt: false },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const subTabBase = 'border-b-2 px-3 py-1.5 text-sm font-medium transition';
  const subTabActive = 'border-indigo-500 text-indigo-600 dark:text-indigo-400';
  const subTabInactive = 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200';
</script>

<svelte:head><title>Memories · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- #364: section caption — the org H1 now lives on the Profile tab only. -->
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Memories</h1>
    <p class="mt-1 text-sm text-zinc-500">Memories owned by this organization and the ones it subscribes to.</p>
  </div>

  <!-- #342: secondary tab row (Org Memories / Subscriptions) -->
  <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
    <button type="button" onclick={() => (subTab = 'org')} class="{subTabBase} {subTab === 'org' ? subTabActive : subTabInactive}">
      {t('org-memories.subtab.org', 'Org Memories')}
    </button>
    <button type="button" onclick={() => (subTab = 'subscriptions')} class="{subTabBase} {subTab === 'subscriptions' ? subTabActive : subTabInactive}">
      {t('org-memories.subtab.subscriptions', 'Subscriptions')}
      <span class="ml-1 text-xs font-normal text-zinc-400">({subscriptions.length})</span>
    </button>
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

  {#if subTab === 'org'}
    {#if rows.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('org-memories.empty', 'No memories yet.')} <a href="/app/orgs/{org.id}/memories/new" class="text-indigo-600 hover:underline dark:text-indigo-400">{t('org-memories.add-one', 'Add one →')}</a>
      </div>
    {:else}
      <!-- 26rem offset tuned to this page's chrome height (sub-tabs above,
           action buttons below) — per-page convention. -->
      <DataTable
        {table}
        listKey="orgs:memories"
        searchPlaceholder={t('org-memories.search.placeholder', 'Search memories...')}
        searchAriaLabel={t('org-memories.search.aria-label', 'Search memories')}
        bind:globalFilter
        maxHeight="max(200px, calc(100vh - 26rem))"
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
              {/if}
            </div>
          {:else}
            {@const f = fmt[cell.column.id]}
            <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
          {/if}
        {/snippet}
      </DataTable>
    {/if}

    <!-- #342: actions moved below the table -->
    <div class="flex items-center gap-3">
      <a href="/app/orgs/{org.id}/memories/new" class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
        + Add memory
      </a>
      <form method="POST" action="?/syncAll" use:enhance>
        <button type="submit" class="cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          Sync all
        </button>
      </form>
    </div>
  {:else}
    <!-- #342: Subscriptions sub-tab — table of subscribed memories + the
         subscribe form. -->
    {#if subscriptions.length === 0}
      <p class="text-sm text-zinc-500">{t('org-memories.subscriptions.empty', 'Not subscribed to any memories yet.')}</p>
    {:else}
      <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th class="px-4 py-2.5">{t('org-memories.column.name', 'Name')}</th>
              <th class="px-4 py-2.5">{t('org-memories.column.urn', 'URN')}</th>
              <th class="px-4 py-2.5">{t('org-memories.subscriptions.role', 'Role')}</th>
              <th class="px-4 py-2.5">{t('org-memories.column.from', 'From')}</th>
              <th class="px-4 py-2.5 text-right">{t('org-memories.column.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
            {#each subscriptions as s (s.memory.id)}
              <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
                <td class="px-4 py-2.5">
                  <a href="/app/memories/{s.memory.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{s.memory.name}</a>
                </td>
                <td class="px-4 py-2.5"><Urn value={s.memory.urn} type="memory" size={10} /></td>
                <td class="px-4 py-2.5">
                  <span class="inline-block rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">{s.role}</span>
                </td>
                <td class="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{s.memory.organization?.name ?? t('org-memories.unknown', 'unknown')}</td>
                <td class="px-4 py-2.5 text-right">
                  <form method="POST" action="?/unsubscribe" use:enhance onsubmit={(e) => { if (!confirm(`Unsubscribe from "${s.memory.name}"?`)) e.preventDefault(); }}>
                    <input type="hidden" name="memoryId" value={s.memory.id} />
                    <button type="submit" class="text-red-400 hover:text-red-300">Unsubscribe</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Subscribe to external memories (moved here from the page footer) -->
    <div class="pt-2">
      <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Subscribe to a memory</h2>
      {#if data.availableMemories.length === 0}
        <p class="text-sm text-zinc-500">No public memories available to subscribe to.</p>
      {:else}
        <form method="POST" action="?/subscribe" use:enhance={() => {
          return async ({ result, update }) => {
            await update();
            // Keep the selection on failure so the user can retry without re-picking.
            if (result.type === 'success') selectedSubscribeMemoryId = '';
          };
        }} class="flex items-end gap-3 max-w-lg">
          <div class="flex-1">
            <label for="subscribe-memory-button" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Public memory</label>
            <button
              id="subscribe-memory-button"
              type="button"
              onclick={() => (subscribeMemoryOpen = true)}
              aria-haspopup="dialog"
              aria-expanded={subscribeMemoryOpen}
              class="w-full truncate rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
            >
              {selectedSubscribeMemory ? selectedSubscribeMemory.name : 'Select a memory...'}
            </button>
            <input type="hidden" name="memoryId" value={selectedSubscribeMemoryId} />
          </div>
          <div>
            <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
            <select id="subRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="READER">Reader</option>
              <option value="CONTRIBUTOR">Contributor</option>
            </select>
          </div>
          <button type="submit" disabled={!selectedSubscribeMemoryId} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">Subscribe</button>
        </form>

        <SelectMemory
          memories={data.availableMemories}
          bind:open={subscribeMemoryOpen}
          onselect={(memory) => (selectedSubscribeMemoryId = memory.id)}
        />
      {/if}
    </div>
  {/if}
</div>
