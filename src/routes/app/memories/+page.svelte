<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  // "My memories" — the caller's own (org-less, user-owned) memories — plus a
  // "Memories shared with me" tab listing memories other users shared with the
  // caller via MemoryShare (#778). Both lists use the shared TanStack DataTable.
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { memoryClassLabel as classLabel } from '$lib/memory-class-label';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const memories = $derived(data.memories ?? []);
  const loadFailed = $derived(data.loadFailed === true);
  const sharedMemories = $derived(data.sharedMemories ?? []);
  const sharedLoadFailed = $derived(data.sharedLoadFailed === true);
  // #871: under impersonation both lists are empty BY DESIGN (see the loader).
  const impersonating = $derived(data.impersonating === true);

  // #649: "Leave" (remove a memory someone shared with you). The row's form
  // POSTs ?/leaveShare; while in flight we disable that row's button, and a
  // failure surfaces above the table (success just drops the row on re-load).
  const leaveError = $derived((form as { leaveError?: string } | null)?.leaveError ?? null);
  let leavingId = $state<string | null>(null);
  const leaveConfirmPrefix = t(
    'my-memories.shared.leave.confirm',
    'Remove this memory from those shared with you? You’ll lose access unless it’s shared again.',
  );
  // No-JS confirmation step: an unenhanced POST comes back with pendingLeaveId,
  // and we render an explicit confirm banner instead of having deleted anything.
  const pendingLeaveId = $derived((form as { pendingLeaveId?: string } | null)?.pendingLeaveId ?? null);
  const pendingLeaveName = $derived(
    pendingLeaveId ? (sharedMemories.find((m) => m.id === pendingLeaveId)?.name ?? '') : '',
  );
  // #1020: Leave moved into the row's ⋯ menu, so the row no longer holds its
  // own form. One hidden form below the table carries whichever row was picked.
  let leaveForm = $state<HTMLFormElement | null>(null);
  let leaveTargetId = $state('');
  async function leave(row: { id: string; name: string }) {
    if (!confirm(`${leaveConfirmPrefix}\n\n"${row.name}"`)) return;
    leaveTargetId = row.id;
    await tick();
    leaveForm?.requestSubmit();
  }

  // ── Tabs (ARIA tab pattern) ──────────────────────────────────────────────
  type TabId = 'mine' | 'shared';
  let activeTab = $state<TabId>('mine');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'mine', label: t('my-memories.tab.mine', 'My memories') },
    { id: 'shared', label: t('my-memories.tab.shared', 'Memories shared with me') },
  ];



  const roleLabel = (role: 'reader' | 'writer'): string =>
    role === 'writer'
      ? t('my-memories.shared.role.writer', 'Can edit')
      : t('my-memories.shared.role.reader', 'Read only');
  const grantorLabel = (grantor: { handle: string | null; name: string | null }): string =>
    grantor.handle
      ? `@${grantor.handle}`
      : (grantor.name ?? t('my-memories.shared.grantor-unknown', 'someone'));

  const NAME_COL = () => t('my-memories.col.name', 'Name');

  // ── My memories table ────────────────────────────────────────────────────
  interface MyMemoryRow { id: string; name: string; urn: string; class: string }
  const myRows = $derived<MyMemoryRow[]>(
    memories.map((m) => ({ id: m.id, name: m.name, urn: m.urn, class: m.class ?? '' })),
  );
  let mineFilter = $state('');
  const myColumns: PortalColumnDef<MyMemoryRow>[] = [
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
  const sharedColumns: PortalColumnDef<SharedRow>[] = [
    { accessorKey: 'name', header: NAME_COL(), enableHiding: false, size: 240 },
    { accessorKey: 'urn', header: 'URN', size: 240 },
    { accessorKey: 'sharedBy', id: 'sharedBy', header: t('my-memories.col.shared-by', 'Shared by'), size: 150 },
    { accessorKey: 'role', id: 'access', header: t('my-memories.col.access', 'Access'), size: 110 },
    { id: 'actions', header: t('my-memories.col.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
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
  });
</script>

<svelte:head><title>{t('my-memories.title', 'My memories — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-4xl space-y-4 py-6">
  <LiveRegion>
    {#if $page.url.searchParams.get('transferred') === '1'}
      <p class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{t('memory-transfer.done-other-user', 'Ownership transferred. The receiving user now has access to the memory.')}</p>
    {/if}
  </LiveRegion>
  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-memories.heading', 'My memories')}</h1>
    <!-- #871: a support session is read-only server-side, so creating would
         open a form whose save cannot succeed. -->
    {#if !impersonating}
      <a
        href="/app/memories/new"
        class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >{t('my-memories.new', 'New memory')}</a>
    {/if}
  </div>

  <!-- Tabs (ARIA tab pattern) -->
  <TabRow items={tabs} active={activeTab} label={t('my-memories.tabs-label', 'Memories')} onselect={(id) => activeTab = id as typeof activeTab}>
    {#snippet itemLabel(tab)}
      {tab.label}
      {#if tab.id === 'shared' && sharedRows.length > 0}<span class="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{sharedRows.length}</span>{/if}
    {/snippet}
  </TabRow>

  <!-- My memories panel -->
  {#if activeTab === 'mine'}
    <div id="panel-mine" role="tabpanel" aria-labelledby="tab-mine" tabindex="0" class="space-y-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      {#if loadFailed}
        <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('my-memories.load-failed', "Couldn't load your memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
        </div>
      {:else if myRows.length === 0}
        <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          {#if impersonating}
            <!-- #871: says WHY the list is empty, and promises nothing about
                 what it would hold, nor who else may access a memory
                 (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee). -->
            <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.empty.support-session', 'Personal memories aren’t shown in a support session, so this list is always empty here, whether or not this account has any.')}</p>
          {:else}
            <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.empty', "You don't have any memories yet.")}</p>
            <a href="/app/memories/new" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('my-memories.empty-cta', 'Create your first memory')}</a>
          {/if}
        </div>
      {:else}
        <DataTable
          table={myTable}
          listKey="memories:mine"
          searchPlaceholder={t('my-memories.search', 'Search memories…')}
          searchAriaLabel={t('my-memories.search', 'Search memories…')}
          bind:globalFilter={mineFilter}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'name'}
              <a href="/app/memories/{row.id}" class="inline-block max-w-full truncate align-bottom font-medium text-indigo-600 hover:underline dark:text-indigo-300" title={row.name}>{row.name}</a>
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
    <div id="panel-shared" role="tabpanel" aria-labelledby="tab-shared" tabindex="0" class="space-y-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      {#if sharedLoadFailed}
        <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('my-memories.shared.load-failed', "Couldn't load memories shared with you just now — this is a temporary error, not an empty list. Try refreshing the page.")}
        </div>
      {:else if sharedRows.length === 0}
        <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          {#if impersonating}
            <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.shared.empty.support-session', 'Memories shared with this account aren’t shown in a support session, so this list is always empty here, whether or not any have been shared.')}</p>
          {:else}
            <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-memories.shared.empty', 'No one has shared a memory with you yet.')}</p>
          {/if}
        </div>
      {:else}
        {#if leaveError}
          <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {leaveError}
          </div>
        {/if}

        <!-- No-JS confirmation step (the enhanced path confirms in the browser
             and never lands here). -->
        {#if pendingLeaveId}
          <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            <p>
              {leaveConfirmPrefix}
              {#if pendingLeaveName}<strong class="font-semibold">{pendingLeaveName}</strong>{/if}
            </p>
            <div class="mt-3 flex items-center gap-2">
              <form method="POST" action="?/leaveShare">
                <input type="hidden" name="memoryId" value={pendingLeaveId} />
                <input type="hidden" name="confirm" value="yes" />
                <button
                  type="submit"
                  class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                >{t('my-memories.shared.leave.confirm-cta', 'Yes, leave')}</button>
              </form>
              <a
                href="/app/memories"
                class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >{t('my-memories.shared.leave.cancel', 'Cancel')}</a>
            </div>
          </div>
        {/if}
        <DataTable
          table={sharedTable}
          listKey="memories:shared"
          searchPlaceholder={t('my-memories.shared.search', 'Search shared memories…')}
          searchAriaLabel={t('my-memories.shared.search', 'Search shared memories…')}
          bind:globalFilter={sharedFilter}
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
            {:else if cell.column.id === 'actions'}
              <NodeActionsMenu
                actions={[{
                  id: 'leave',
                  label: leavingId === row.id
                    ? t('my-memories.shared.leaving', 'Leaving…')
                    : t('my-memories.shared.leave', 'Leave'),
                  danger: true,
                }]}
                onselect={() => leave(row)}
                label={t('my-memories.shared.actions.label', 'Actions for {name}', { name: row.name })}
                disabled={leavingId === row.id}
                fixed
                compact
              />
            {/if}
          {/snippet}
        </DataTable>
        <form
          bind:this={leaveForm}
          method="POST"
          action="?/leaveShare"
          class="hidden"
          use:enhance={({ formData }) => {
            // Confirmed in the browser by leave() — tell the server to skip
            // its own (no-JS) confirm step.
            formData.set('confirm', 'yes');
            // Capture the id so a second, faster submit can't clear this row's
            // in-flight flag, and always clear in finally so a network error
            // can't leave the row's menu stuck disabled.
            const id = String(formData.get('memoryId') ?? '');
            leavingId = id;
            return async ({ update }) => {
              try {
                await update();
              } finally {
                if (leavingId === id) leavingId = null;
              }
            };
          }}
        >
          <input type="hidden" name="memoryId" value={leaveTargetId} />
        </form>
      {/if}
    </div>
  {/if}
</div>
