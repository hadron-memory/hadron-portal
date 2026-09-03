<script lang="ts">
  // #798: the org list was a bespoke card grid. Converted to the shared
  // TanStack DataTable, which is the default for every list (CLAUDE.md) —
  // it brings the saved-view tab strip, search, the column toggle, sortable
  // resizable headers and pagination, none of which a card grid has.
  //
  // Mirrors /app/apps and /app/agents deliberately: a reader moves between the
  // three top-level "things I own" lists, and they should read as one surface.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const orgs = $derived(data.orgs ?? []);

  interface OrgRow {
    id: string;
    name: string;
    urn: string;
    members: number;
    memories: number;
    agents: number;
    apps: number;
    createdAt: string | null;
  }

  // Counts come from arrays ORGANIZATIONS_QUERY already selects, so no column
  // here adds a round trip. That query has 14 consumers, so narrowing it to
  // counts is deliberately NOT done as part of a list conversion
  // (`review:shared-layout-payload-consumers`) — worth its own change.
  const rows = $derived<OrgRow[]>(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      urn: o.urn,
      members: o.members?.length ?? 0,
      memories: o.memories?.length ?? 0,
      agents: o.agents?.length ?? 0,
      apps: o.apps?.length ?? 0,
      createdAt: o.createdAt ?? null,
    })),
  );

  // `review:date-column-sorts-by-instant`: the comparator must see epoch millis.
  // TanStack picks `alphanumeric` for an ISO string, which compares digit groups
  // and IGNORES the offset — so it orders by wall clock, not by instant, and
  // `DateTime` only guarantees the value is Date.parse-able, not UTC.
  function dateMs(iso: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? null : ms;
  }
  // Same options as the sibling grids (@copilot): a bare `toLocaleDateString()`
  // renders differently across browsers and locales, so two portal tables open
  // side by side would disagree about how a date looks. Matches
  // orgs/[id]/sessions and orgs/[id]/memories verbatim — this is now the third
  // copy of the helper, which is worth extracting, but not inside a list
  // conversion touching one file.
  function formatDate(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  let globalFilter = $state('');
  const columns: PortalColumnDef<OrgRow>[] = [
    { accessorKey: 'name', header: t('orgs.col.name', 'Name'), enableHiding: false, size: 220 },
    { accessorKey: 'urn', header: 'URN', size: 300 },
    // Counts are plain numbers, which is simply their natural type — NOT, as I
    // first assumed, because a string accessor would misorder them. It would
    // not: TanStack picks `alphanumeric` for a numeric string, and that
    // comparator comes apart into digit groups and compares those NUMERICALLY,
    // so "13" still sorts after "2". Measured, after writing a test to pin the
    // opposite and watching it fail.
    //
    // Worth the note because it is the same misreading the date-column check
    // warns about from the other side: `alphanumeric` is neither lexicographic
    // nor numeric, and reasoning about byte order gives the wrong answer in
    // both directions. See
    // `hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant`.
    { accessorKey: 'members', header: t('orgs.col.members', 'Members'), size: 110 },
    { accessorKey: 'memories', header: t('orgs.col.memories', 'Memories'), size: 110 },
    { accessorKey: 'agents', header: t('orgs.col.agents', 'Agents'), size: 100 },
    { accessorKey: 'apps', header: t('orgs.col.apps', 'Apps'), size: 100 },
    {
      accessorFn: (row) => dateMs(row.createdAt),
      id: 'createdAt',
      header: t('orgs.col.created', 'Created'),
      size: 130,
    },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    createdAt: (v) => formatDate(v as number | null),
  };

  const table = createSvelteTable<OrgRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<svelte:head><title>{t('orgs.title', 'Organizations · Hadron')}</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('orgs.heading', 'Organizations')}</h1>
      <!-- "you have access to", not "you belong to" (@codex P2). This list is
           NOT always memberships: `ORGANIZATIONS_QUERY`'s own comment names
           /app/orgs as an admin BROWSE surface, where a platform ADMIN/OWNER
           receives every live org including ones they are not a member of. The
           subhead is new in this PR, so the narrower wording would have been a
           claim the page cannot keep, for exactly the readers most likely to
           notice. One sentence that is true for both populations beats
           branching the copy on a role the page would have to fetch. -->
      <p class="text-sm text-zinc-500">{t('orgs.subhead', 'Organizations you have access to.')}</p>
    </div>
    <a
      href="/app/orgs/new"
      class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >{t('orgs.new', 'New organization')}</a>
  </div>

  {#if rows.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <!-- Same scope correction as the subhead, one line further down. This
           copy is pre-existing, but it makes the identical claim — an ADMIN
           seeing an empty list is not being told "you have no memberships",
           they are being told there are no orgs at all — and leaving it would
           have the page contradict the subhead I just fixed two elements
           above. Neutral wording is true for both readers. -->
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('orgs.empty', 'No organizations yet.')}</p>
      <a
        href="/app/orgs/new"
        class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >{t('orgs.empty-cta', 'Create your first organization')}</a>
    </div>
  {:else}
    <!-- `orgs:mine` is unique: the existing `orgs:*` keys all scope a list
         INSIDE one org (orgs:members, orgs:memories, …). Sharing a key would
         silently share this list's arrangement with one of those
         (`review:saved-view-arrangement-not-position`). -->
    <DataTable
      {table}
      listKey="orgs:mine"
      searchPlaceholder={t('orgs.search', 'Search organizations…')}
      searchAriaLabel={t('orgs.search', 'Search organizations…')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 21rem))"
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <a href="/app/orgs/{row.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
        {:else if cell.column.id === 'urn'}
          <Urn value={row.urn} type="org" size={8} />
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
