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
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  import { tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PortalCell, PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import {
    deleteOrgMemorySchema,
    orgMemorySubscribeSchema,
    syncOrgMemoriesSchema,
    unsubscribeOrgMemorySchema,
  } from './schema';

  type DeleteOrgMemoryForm = Infer<typeof deleteOrgMemorySchema, 'zod4'>;
  type OrgMemorySubscribeForm = Infer<typeof orgMemorySubscribeSchema, 'zod4'>;
  type SyncOrgMemoriesForm = Infer<typeof syncOrgMemoriesSchema, 'zod4'>;
  type UnsubscribeOrgMemoryForm = Infer<typeof unsubscribeOrgMemorySchema, 'zod4'>;
  type DeleteOrgMemorySuperform = SuperValidated<DeleteOrgMemoryForm, App.Superforms.Message, DeleteOrgMemoryForm>;
  type OrgMemorySubscribeSuperform = SuperValidated<OrgMemorySubscribeForm, App.Superforms.Message, OrgMemorySubscribeForm>;
  type SyncOrgMemoriesSuperform = SuperValidated<SyncOrgMemoriesForm, App.Superforms.Message, SyncOrgMemoriesForm>;
  type UnsubscribeOrgMemorySuperform = SuperValidated<UnsubscribeOrgMemoryForm, App.Superforms.Message, UnsubscribeOrgMemoryForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  // #342/#555: secondary tabs — Personal Memories | Org Memories |
  // Subscriptions. Personal Memories (to the left of Org Memories) was split out
  // now that memories can be owned by users directly. The initial tab honors the
  // loader's ?tab= hint (the create flow deep-links back to 'personal').
  let subTab = $state<'personal' | 'org' | 'subscriptions'>(untrack(() => data.initialTab));
  const subscriptions = $derived(org.subscriptions ?? []);

  // Subscribe form: the memory <select> is replaced by the SelectMemory modal
  // picker (searchable, paginated) — same pattern as the agent detail page.
  let subscribeMemoryOpen = $state(false);
  const initialSubscribeForm = untrack(() => submittedForm<OrgMemorySubscribeForm>(form, 'subscribeMemory') as OrgMemorySubscribeSuperform | null ?? data.subscribeForm);
  const {
    form: subscribeForm,
    errors: subscribeErrors,
    message: subscribeMessage,
    submitting: subscribeSubmitting,
    enhance: subscribeEnhance,
  } = superForm<OrgMemorySubscribeForm, App.Superforms.Message, OrgMemorySubscribeForm>(initialSubscribeForm, {
    validators: zod4Client(orgMemorySubscribeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') {
        subscribeForm.update((current) => ({ ...current, memoryId: '' }), { taint: false });
      }
    },
  });
  const initialDeleteForm = untrack(() => submittedForm<DeleteOrgMemoryForm>(form, 'deleteMemory') as DeleteOrgMemorySuperform | null ?? data.deleteForm);
  const {
    form: deleteForm,
    errors: deleteErrors,
    message: deleteMessage,
    submitting: deleteSubmitting,
    enhance: deleteEnhance,
  } = superForm<DeleteOrgMemoryForm, App.Superforms.Message, DeleteOrgMemoryForm>(initialDeleteForm, {
    validators: zod4Client(deleteOrgMemorySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const initialSyncAllForm = untrack(() => submittedForm<SyncOrgMemoriesForm>(form, 'syncMemories') as SyncOrgMemoriesSuperform | null ?? data.syncAllForm);
  const {
    message: syncAllMessage,
    submitting: syncAllSubmitting,
    enhance: syncAllEnhance,
  } = superForm<SyncOrgMemoriesForm, App.Superforms.Message, SyncOrgMemoriesForm>(initialSyncAllForm, {
    validators: zod4Client(syncOrgMemoriesSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const initialUnsubscribeForm = untrack(() => submittedForm<UnsubscribeOrgMemoryForm>(form, 'unsubscribeMemory') as UnsubscribeOrgMemorySuperform | null ?? data.unsubscribeForm);
  const {
    form: unsubscribeForm,
    errors: unsubscribeErrors,
    message: unsubscribeMessage,
    submitting: unsubscribeSubmitting,
    enhance: unsubscribeEnhance,
  } = superForm<UnsubscribeOrgMemoryForm, App.Superforms.Message, UnsubscribeOrgMemoryForm>(initialUnsubscribeForm, {
    validators: zod4Client(unsubscribeOrgMemorySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const selectedSubscribeMemory = $derived(
    data.availableMemories.find((m) => m.id === $subscribeForm.memoryId),
  );
  const subscribeMemoryError = $derived($subscribeErrors.memoryId?.[0] ?? null);
  const subscribeActionError = $derived($subscribeMessage?.type === 'error' ? $subscribeMessage.text : null);
  const subscribeActionSuccess = $derived($subscribeMessage?.type === 'success' ? $subscribeMessage.text : null);
  const deleteActionError = $derived(
    $deleteMessage?.type === 'error'
      ? $deleteMessage.text
      : $deleteErrors.id?.[0] ?? $deleteErrors._kind?.[0] ?? null,
  );
  const deleteActionSuccess = $derived($deleteMessage?.type === 'success' ? $deleteMessage.text : null);
  const syncAllActionError = $derived($syncAllMessage?.type === 'error' ? $syncAllMessage.text : null);
  const syncAllActionSuccess = $derived($syncAllMessage?.type === 'success' ? $syncAllMessage.text : null);
  const unsubscribeActionError = $derived(
    $unsubscribeMessage?.type === 'error'
      ? $unsubscribeMessage.text
      : $unsubscribeErrors.memoryId?.[0] ?? $unsubscribeErrors._kind?.[0] ?? null,
  );
  const unsubscribeActionSuccess = $derived($unsubscribeMessage?.type === 'success' ? $unsubscribeMessage.text : null);
  $effect(() => {
    const submitted = submittedForm<OrgMemorySubscribeForm>(form, 'subscribeMemory') as OrgMemorySubscribeSuperform | null;
    if (submitted && (!submitted.valid || submitted.message?.type === 'error')) {
      subTab = 'subscriptions';
    }
  });
  $effect(() => {
    if (submittedForm<UnsubscribeOrgMemoryForm>(form, 'unsubscribeMemory')) {
      subTab = 'subscriptions';
    }
  });
  $effect(() => {
    if (
      submittedForm<DeleteOrgMemoryForm>(form, 'deleteMemory') ||
      submittedForm<SyncOrgMemoriesForm>(form, 'syncMemories')
    ) {
      subTab = 'org';
    }
  });

  function setDeleteMemory(id: string) {
    deleteForm.update((current) => ({ ...current, id }), { taint: false });
  }

  function setUnsubscribeMemory(memoryId: string) {
    unsubscribeForm.update((current) => ({ ...current, memoryId }), { taint: false });
  }

  // #1020: row actions live in each row's ⋯ menu. Rows no longer hold their
  // own forms; one hidden form per action, below the tables, is submitted for
  // the picked memory after the same browser confirm.
  let deleteMemoryFormEl = $state<HTMLFormElement | null>(null);
  let unsubscribeFormEl = $state<HTMLFormElement | null>(null);
  async function deleteMemory(m: { id: string; name: string }) {
    if ($deleteSubmitting) return;
    if (!confirm(`Delete "${m.name}"?`)) return;
    setDeleteMemory(m.id);
    await tick();
    deleteMemoryFormEl?.requestSubmit();
  }
  async function unsubscribeMemory(m: { id: string; name: string }) {
    if ($unsubscribeSubmitting) return;
    if (!confirm(`Unsubscribe from "${m.name}"?`)) return;
    setUnsubscribeMemory(m.id);
    await tick();
    unsubscribeFormEl?.requestSubmit();
  }

  // 'personal' = the user-owned section (spans the personal + private memory
  // classes); the class itself is carried in `badge` (Personal vs Private).
  type Section = 'org' | 'personal' | 'system';

  interface MemoryRow {
    id: string; // memory id — nav target and delete payload
    name: string;
    urn: string;
    section: Section;
    /** Badge text: visibility (org), Personal/Private class, or system — the
     *  colored chip that rendered per-section in the old card layout. */
    badge: string;
    storage: string | null; // git-backed / DB-only (org rows only)
    branch: string | null;
    lastSyncedAt: string | null;
    // #397: spec-033 vector-index status, surfaced as a column. embeddingSource
    // is only meaningful while the index is enabled.
    vectorIndexEnabled: boolean;
    embeddingSource: string | null;
    /** Sortable/filterable summary of the two fields above. */
    vectorIndex: string;
  }

  // #397: human label for the spec-033 EmbeddingSource enum.
  function embeddingSourceLabel(source: string | null): string {
    switch (source) {
      case 'abstract':
        return t('org-memories.vector-index.source.abstract', 'Abstract');
      case 'contentChunks':
        return t('org-memories.vector-index.source.content-chunks', 'Content chunks');
      case 'both':
        return t('org-memories.vector-index.source.both', 'Abstract + content');
      default:
        return source ?? '';
    }
  }

  // #397: summary string for sorting/global filtering on the vector-index column.
  // Mirror the settings page: a null embeddingSource means the 'abstract' default
  // while the index is enabled, so it gets a source label rather than rendering bare.
  function vectorIndexSummary(enabled?: boolean | null, source?: string | null): string {
    if (!enabled) return t('org-memories.vector-index.off', 'Off');
    const label = embeddingSourceLabel(source ?? 'abstract');
    const on = t('org-memories.vector-index.on', 'Enabled');
    return label ? `${on} · ${label}` : on;
  }

  // #342: subscribed memories moved to their own sub-tab. #555: private/personal
  // memories moved to the "Personal Memories" tab, so the org grid now carries
  // only org + system memories.
  const orgRows = $derived<MemoryRow[]>([
    ...(org.memories ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      urn: g.urn,
      section: 'org' as const,
      badge: g.visibility ?? '—',
      storage: g.source ? 'git-backed' : 'DB-only',
      branch: g.readBranch,
      lastSyncedAt: g.lastSyncedAt,
      vectorIndexEnabled: g.vectorIndexEnabled ?? false,
      embeddingSource: g.embeddingSource ?? null,
      vectorIndex: vectorIndexSummary(g.vectorIndexEnabled, g.embeddingSource),
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
      vectorIndexEnabled: g.vectorIndexEnabled ?? false,
      embeddingSource: g.embeddingSource ?? null,
      vectorIndex: vectorIndexSummary(g.vectorIndexEnabled, g.embeddingSource),
    })),
  ]);

  // #555: the caller's own personal memories (the personal + private classes),
  // surfaced in the Personal Memories tab. These carry no git storage/branch/sync.
  const personalRows = $derived<MemoryRow[]>(
    (data.personalMemories ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      urn: g.urn,
      section: 'personal' as const,
      // #2140: the caller's own org-less system memory lands here too.
      badge: g.class === 'private' ? 'Private' : g.class === 'system' ? 'System' : 'Personal',
      storage: null,
      branch: null,
      lastSyncedAt: null,
      vectorIndexEnabled: g.vectorIndexEnabled ?? false,
      embeddingSource: g.embeddingSource ?? null,
      vectorIndex: vectorIndexSummary(g.vectorIndexEnabled, g.embeddingSource),
    })),
  );

  // Badge chip colors — preserves the per-section palette of the old card
  // layout (visibility green/zinc, personal amber, system purple).
  function badgeClass(row: MemoryRow): string {
    if (row.section === 'personal') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    if (row.section === 'system') return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    return row.badge === 'PUBLIC'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  }

  // Epoch milliseconds (or null when absent/unparseable) so the Last-synced column
  // sorts by instant rather than by the raw wire string. The `DateTime` scalar only
  // guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC — so a
  // pass-through value carrying a non-UTC offset makes lexicographic string order
  // differ from chronological order. See hadron-server
  // hrn:node:hadronmemory.com:hadron-server:conventions:datetime-scalar-for-date-fields.
  function dateMs(val: string | null): number | null {
    if (!val) return null;
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  }

  function formatDate(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let globalFilter = $state('');

  const columns: PortalColumnDef<MemoryRow>[] = [
    { accessorKey: 'name', header: t('org-memories.column.name', 'Name'), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: t('org-memories.column.urn', 'URN'), size: 280 },
    { accessorKey: 'badge', id: 'type', header: t('org-memories.column.type', 'Type'), size: 110 },
    { accessorKey: 'vectorIndex', header: t('org-memories.column.vector-index', 'Vector index'), size: 150 },
    { accessorKey: 'storage', header: t('org-memories.column.storage', 'Storage'), size: 100 },
    { accessorKey: 'branch', header: t('org-memories.column.branch', 'Branch'), size: 100 },
    { accessorFn: (row) => dateMs(row.lastSyncedAt), id: 'lastSyncedAt', header: t('org-memories.column.last-synced', 'Last synced'), size: 120 },
    { id: 'actions', header: t('org-memories.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];

  // #555: personal memories are owner-only and DB-only, so the grid drops the
  // git-oriented Storage/Branch/Last-synced columns entirely.
  const personalColumns: PortalColumnDef<MemoryRow>[] = [
    { accessorKey: 'name', header: t('org-memories.column.name', 'Name'), enableHiding: false, size: 200 },
    { accessorKey: 'urn', header: t('org-memories.column.urn', 'URN'), size: 280 },
    { accessorKey: 'badge', id: 'type', header: t('org-memories.column.type', 'Type'), size: 110 },
    { accessorKey: 'vectorIndex', header: t('org-memories.column.vector-index', 'Vector index'), size: 150 },
    { id: 'actions', header: t('org-memories.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    storage: (v) => (v as string | null) ?? '—',
    branch: (v) => (v as string | null) ?? '—',
    lastSyncedAt: (v) => formatDate(v as number | null),
  };

  const table = createSvelteTable<MemoryRow>({
    get data() {
      return orgRows;
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
    // #820 — `lastSyncedAt` accessors epoch millis so the column sorts by
    // instant; the date on screen was unsearchable. Same `fmt` the cell uses.
    globalFilterFn: makeGlobalFilterFn<MemoryRow>(fmt, {
      lastSyncedAt: (row) => row.lastSyncedAt,
    }),
    // #341: Storage / Branch / Last-synced hidden in the default view (still
    // available via the column menu, and preserved by user-saved views).
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      columnVisibility: { storage: false, branch: false, lastSyncedAt: false },
    },
  });

  // #555: independent table instance for the Personal Memories tab so its
  // search / sort / pagination state stays separate from the org grid.
  let personalGlobalFilter = $state('');
  const personalTable = createSvelteTable<MemoryRow>({
    get data() {
      return personalRows;
    },
    columns: personalColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return personalGlobalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      personalGlobalFilter = typeof u === 'function' ? u(personalGlobalFilter) : u;
    },
    // #820 — `lastSyncedAt` accessors epoch millis so the column sorts by
    // instant; the date on screen was unsearchable. Same `fmt` the cell uses.
    globalFilterFn: makeGlobalFilterFn<MemoryRow>(fmt, {
      lastSyncedAt: (row) => row.lastSyncedAt,
    }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });

  // #858 — `shrink-0 whitespace-nowrap` is what makes the strip SCROLL rather
  // than squash. Measured at 390px before the fix: the three tabs were forced
  // to 96/89/115px in a 308px row and every label wrapped, so each tab stood
  // 74px tall — two lines of compressed text. The page did not overflow because
  // the labels were being crushed instead, which is the failure this looks like
  // when the rail cannot scroll.

  // #2316: the Subscriptions sub-tab on the shared grid; its own table instance
  // so search / sort / pagination stay separate from the other two.
  type SubscriptionRow = (typeof subscriptions)[number];
  let subscriptionFilter = $state('');
  const subscriptionColumns: PortalColumnDef<SubscriptionRow>[] = [
    { accessorFn: (s) => s.memory.name, id: 'name', header: t('org-memories.column.name', 'Name'), enableHiding: false, size: 200 },
    { accessorFn: (s) => s.memory.urn, id: 'urn', header: t('org-memories.column.urn', 'URN'), size: 280 },
    { accessorKey: 'role', header: t('org-memories.subscriptions.role', 'Role'), size: 110 },
    { accessorFn: (s) => s.memory.organization?.name ?? t('org-memories.unknown', 'unknown'), id: 'from', header: t('org-memories.column.from', 'From'), size: 160 },
    { id: 'actions', header: t('org-memories.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];
  const subscriptionTable = createSvelteTable<SubscriptionRow>({
    get data() {
      return subscriptions;
    },
    columns: subscriptionColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return subscriptionFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      subscriptionFilter = typeof u === 'function' ? u(subscriptionFilter) : u;
    },
    globalFilterFn: makeGlobalFilterFn<SubscriptionRow>({}, {}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<svelte:head><title>Memories · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- #364: section caption — the org H1 now lives on the Profile tab only. -->
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Memories</h1>
    <p class="mt-1 text-sm text-zinc-500">Your personal memories, the ones owned by this organization, and the ones it subscribes to.</p>
  </div>

  <!-- #342/#555: secondary tab row (Personal Memories / Org Memories / Subscriptions) -->
  <TabRow items={[
    { id: 'personal', label: t('org-memories.subtab.personal', 'Personal Memories'), badge: `(${personalRows.length})` },
    { id: 'org', label: t('org-memories.subtab.org', 'Org Memories') },
    { id: 'subscriptions', label: t('org-memories.subtab.subscriptions', 'Subscriptions'), badge: `(${subscriptions.length})` }
  ]} active={subTab} label={t('org-memories.tabs-label', 'Memory lists')} onselect={(id) => subTab = id as typeof subTab} />
  <div class="space-y-4" role="tabpanel" id="panel-{subTab}" aria-labelledby="tab-{subTab}" tabindex="0">

  {#if deleteActionError || syncAllActionError || unsubscribeActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      {deleteActionError ?? syncAllActionError ?? unsubscribeActionError}
    </div>
  {/if}
  <LiveRegion>
    {#if deleteActionSuccess || syncAllActionSuccess || unsubscribeActionSuccess || subscribeActionSuccess}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        {deleteActionSuccess ?? syncAllActionSuccess ?? unsubscribeActionSuccess ?? subscribeActionSuccess}
      </div>
    {/if}
  </LiveRegion>

  <!-- #555: shared cell renderer — reused by the Personal and Org grids. The
       Delete action stays org-only (owner-only memories are managed from their
       detail page), so personal rows render just the Edit link. -->
  {#snippet memoryCell(cell: PortalCell<MemoryRow, unknown>, m: MemoryRow)}
    {#if cell.column.id === 'name'}
      <div class="truncate" title={m.name}>
        <a href="/app/memories/{m.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
      </div>
    {:else if cell.column.id === 'urn'}
      <Urn value={m.urn} type="memory" size={10} />
    {:else if cell.column.id === 'type'}
      <span data-testid="row-type-badge" class="inline-block max-w-full rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere] {badgeClass(m)}">{m.badge}</span>
    {:else if cell.column.id === 'vectorIndex'}
      {#if m.vectorIndexEnabled}
        <div class="flex flex-col gap-0.5">
          <span class="inline-block w-fit rounded px-1.5 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">{t('org-memories.vector-index.on', 'Enabled')}</span>
          <!-- null source falls back to the 'abstract' default, matching the settings page. -->
          <span class="text-xs text-zinc-500 dark:text-zinc-400">{embeddingSourceLabel(m.embeddingSource ?? 'abstract')}</span>
        </div>
      {:else}
        <span class="inline-block rounded px-1.5 py-0.5 text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t('org-memories.vector-index.off', 'Off')}</span>
      {/if}
    {:else if cell.column.id === 'actions'}
      <NodeActionsMenu
        actions={[
          { id: 'edit', label: t('org-memories.action.edit', 'Edit'), href: `/app/memories/${m.id}` },
          ...(m.section === 'org' ? [{ id: 'delete', label: t('org-memories.action.delete', 'Delete'), danger: true }] : []),
        ]}
        onselect={(id) => { if (id === 'delete') deleteMemory(m); }}
        label={t('org-memories.actions.label', 'Actions for {name}', { name: m.name })}
        disabled={$deleteSubmitting}
        fixed
        compact
      />
    {:else}
      {@const f = fmt[cell.column.id]}
      <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
    {/if}
  {/snippet}

  {#snippet subscriptionCell(cell: PortalCell<SubscriptionRow, unknown>, s: SubscriptionRow)}
    {#if cell.column.id === 'name'}
      <div class="truncate" title={s.memory.name}>
        <a href="/app/memories/{s.memory.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{s.memory.name}</a>
      </div>
    {:else if cell.column.id === 'urn'}
      <Urn value={s.memory.urn} type="memory" size={10} />
    {:else if cell.column.id === 'role'}
      <span class="inline-block max-w-full rounded px-1.5 py-0.5 text-xs [overflow-wrap:anywhere] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">{s.role}</span>
    {:else if cell.column.id === 'actions'}
      <NodeActionsMenu
        actions={[{ id: 'unsubscribe', label: t('org-memories.action.unsubscribe', 'Unsubscribe'), danger: true }]}
        onselect={(id) => { if (id === 'unsubscribe') unsubscribeMemory(s.memory); }}
        label={t('org-memories.actions.label', 'Actions for {name}', { name: s.memory.name })}
        disabled={$unsubscribeSubmitting}
        fixed
        compact
      />
    {:else}
      <div class="truncate">{cell.getValue()}</div>
    {/if}
  {/snippet}

  {#if subTab === 'personal'}
    <!-- #555: Personal Memories — the caller's own personal memories (the
         personal + private classes) in this org. The create link preselects the
         personal class so the "new" page defaults to it. -->
    <!-- portal#2175 (FIT 6884373873 c): a failed feed read hides its rows
         (fail-closed) but must not read as "no memories" — the degraded flag
         trades the empty-state copy for truthful unavailable copy, and the
         alert also sits above rows that survived another read's failure. -->
    {#if data.personalMemoriesDegraded}
      <div role="alert" class="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('org-memories.personal.load-failed', "Couldn't load your personal memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
      </div>
    {:else if personalRows.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('org-memories.personal.empty', 'No personal memories yet.')} <a href="/app/orgs/{org.id}/memories/new?class=personal" class="text-indigo-600 hover:underline dark:text-indigo-400">{t('org-memories.add-one', 'Add one →')}</a>
      </div>
    {/if}
    {#if personalRows.length > 0}
      <DataTable
        table={personalTable}
        listKey="orgs:memories:personal"
        searchPlaceholder={t('org-memories.search.placeholder', 'Search memories...')}
        searchAriaLabel={t('org-memories.search.aria-label', 'Search memories')}
        bind:globalFilter={personalGlobalFilter}
        cell={memoryCell}
      />
    {/if}

    <!-- #556: keep the Add-memory affordance on this tab too (reviewer note) —
         no Sync all, since personal memories are DB-only. -->
    <div class="flex items-center gap-3">
      <a href="/app/orgs/{org.id}/memories/new?class=personal" class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
        + Add memory
      </a>
    </div>
  {:else if subTab === 'org'}
    <!-- portal#2175 (FIT 6884373873 c): same trade as the personal tab — a
         failed system-rows read hides its rows but never reads as "no
         memories", and the alert sits above whatever rows the org read did
         return. -->
    {#if data.systemMemoriesDegraded}
      <div role="alert" class="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('org-memories.load-failed', "Couldn't load this organization's memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
      </div>
    {:else if orgRows.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('org-memories.empty', 'No memories yet.')} <a href="/app/orgs/{org.id}/memories/new" class="text-indigo-600 hover:underline dark:text-indigo-400">{t('org-memories.add-one', 'Add one →')}</a>
      </div>
    {/if}
    {#if orgRows.length > 0}
      <!-- 26rem offset tuned to this page's chrome height (sub-tabs above,
           action buttons below) — per-page convention. -->
      <DataTable
        {table}
        listKey="orgs:memories"
        searchPlaceholder={t('org-memories.search.placeholder', 'Search memories...')}
        searchAriaLabel={t('org-memories.search.aria-label', 'Search memories')}
        bind:globalFilter
        cell={memoryCell}
      />
    {/if}

    <!-- #342: actions moved below the table -->
    <div class="flex items-center gap-3">
      <a href="/app/orgs/{org.id}/memories/new" class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
        + Add memory
      </a>
      <form method="POST" action="?/syncAll" use:syncAllEnhance novalidate>
        <input type="hidden" name="_kind" value="syncMemories" />
        <button type="submit" disabled={$syncAllSubmitting} class="cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          {$syncAllSubmitting ? t('org-memories.syncing', 'Syncing...') : t('org-memories.sync-all', 'Sync all')}
        </button>
      </form>
    </div>
  {:else}
    <!-- #342: Subscriptions sub-tab — table of subscribed memories + the
         subscribe form. -->
    {#if subscriptions.length === 0}
      <p class="text-sm text-zinc-500">{t('org-memories.subscriptions.empty', 'Not subscribed to any memories yet.')}</p>
    {:else}
      <DataTable
        table={subscriptionTable}
        listKey="orgs:memories:subscriptions"
        searchPlaceholder={t('org-memories.subscriptions.search', 'Search subscriptions...')}
        searchAriaLabel={t('org-memories.subscriptions.search-aria', 'Search subscriptions')}
        bind:globalFilter={subscriptionFilter}
        rowAttrs={(s) => ({ 'data-testid': 'subscription-row', 'data-memory-id': s.memory.id })}
        cell={subscriptionCell}
      />
    {/if}

    <!-- Subscribe to external memories (moved here from the page footer) -->
    <div class="pt-2">
      <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Subscribe to a memory</h2>
      <!-- portal#2175: a failed public-memories read empties the whole picker
           feed, so a degraded flag here means the catalogue is missing, not
           absent — the picker is withheld rather than offered over an
           incomplete catalogue. -->
      {#if data.availableMemoriesDegraded}
        <p role="alert" class="text-sm text-amber-700 dark:text-amber-300">{t('org-memories.available.load-failed', "Couldn't load the public memories list just now — this is a temporary error, not an empty catalogue. Try refreshing the page.")}</p>
      {:else if data.availableMemories.length === 0}
        <p class="text-sm text-zinc-500">No public memories available to subscribe to.</p>
      {:else}
        <form method="POST" action="?/subscribe" use:subscribeEnhance class="flex items-start gap-3 max-w-lg" novalidate>
          <input type="hidden" name="_kind" value={$subscribeForm._kind} />
          <div class="flex-1">
            <label for="subscribe-memory-button" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Public memory</label>
            <button
              id="subscribe-memory-button"
              type="button"
              onclick={() => (subscribeMemoryOpen = true)}
              aria-haspopup="dialog"
              aria-expanded={subscribeMemoryOpen}
              aria-describedby={subscribeMemoryError ? 'subscribeMemoryError' : undefined}
              class="w-full truncate rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800 {subscribeMemoryError ? 'border-red-500' : ''}"
            >
              {selectedSubscribeMemory ? selectedSubscribeMemory.name : 'Select a memory...'}
            </button>
            <input type="hidden" name="memoryId" value={$subscribeForm.memoryId} />
            {#if subscribeMemoryError}
              <p id="subscribeMemoryError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{subscribeMemoryError}</p>
            {/if}
            {#if subscribeActionError}
              <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{subscribeActionError}</p>
            {/if}
          </div>
          <div>
            <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
            <select id="subRole" name="role" bind:value={$subscribeForm.role} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="READER">Reader</option>
              <option value="CONTRIBUTOR">Contributor</option>
            </select>
          </div>
          <button type="submit" disabled={!$subscribeForm.memoryId || $subscribeSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
            {$subscribeSubmitting
              ? t('org-memories.subscriptions.subscribing', 'Subscribing...')
              : t('org-memories.subscriptions.subscribe', 'Subscribe')}
          </button>
        </form>

        <SelectMemory
          memories={data.availableMemories}
          bind:open={subscribeMemoryOpen}
          onselect={(memory) => subscribeForm.update((current) => ({ ...current, memoryId: memory.id }))}
        />
      {/if}
    </div>
  {/if}
  <form bind:this={deleteMemoryFormEl} method="POST" action="?/delete" use:deleteEnhance novalidate class="hidden">
    <input type="hidden" name="_kind" value="deleteMemory" />
    <input type="hidden" name="id" value={$deleteForm.id} />
  </form>
  <form bind:this={unsubscribeFormEl} method="POST" action="?/unsubscribe" use:unsubscribeEnhance novalidate class="hidden">
    <input type="hidden" name="_kind" value="unsubscribeMemory" />
    <input type="hidden" name="memoryId" value={$unsubscribeForm.memoryId} />
  </form>

  </div>
</div>
