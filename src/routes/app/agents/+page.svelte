<script lang="ts">
  // #647: "My agents" — the caller's own (org-less, user-owned) agents. Uses the
  // shared TanStack DataTable, mirroring the /app/memories "My memories" list.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const agents = $derived(data.agents ?? []);
  const loadFailed = $derived(data.loadFailed === true);

  interface AgentRow {
    id: string;
    name: string;
    urn: string;
    description: string;
    memories: number;
    visibility: 'PUBLIC' | 'ORGANIZATION' | 'PERSONAL';
  }
  const rows = $derived<AgentRow[]>(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      urn: a.urn,
      description: a.description ?? '',
      // +1 for the agent's own system memory (when it has one) — it isn't part
      // of memoryItems (mirrors the org agents grid count).
      memories: (a.memoryItems?.length ?? 0) + (a.systemMemoryId ? 1 : 0),
      visibility: a.visibility,
    })),
  );

  // Org-less agents are PERSONAL or PUBLIC, but handle every enum value
  // explicitly so an unexpected ORGANIZATION value (e.g. inconsistent historical
  // data) is labelled correctly rather than mislabelled "Personal".
  const visibilityLabel = (v: AgentRow['visibility']): string => {
    switch (v) {
      case 'PUBLIC':
        return t('my-agents.badge.public', 'Public');
      case 'ORGANIZATION':
        return t('my-agents.badge.organization', 'Organization');
      case 'PERSONAL':
      default:
        return t('my-agents.badge.personal', 'Personal');
    }
  };

  let globalFilter = $state('');
  const columns: PortalColumnDef<AgentRow>[] = [
    { accessorKey: 'name', header: t('my-agents.col.name', 'Name'), enableHiding: false, size: 240 },
    { accessorKey: 'urn', header: 'URN', size: 300 },
    { accessorKey: 'description', header: t('my-agents.col.description', 'Description'), size: 280 },
    { accessorKey: 'memories', id: 'memories', header: t('my-agents.col.memories', 'Memories'), size: 110 },
    { accessorKey: 'visibility', id: 'visibility', header: t('my-agents.col.visibility', 'Visibility'), size: 120 },
  ];
  const table = createSvelteTable<AgentRow>({
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

<svelte:head><title>{t('my-agents.title', 'My agents — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-agents.heading', 'My agents')}</h1>
      <p class="text-sm text-zinc-500">{t('my-agents.subhead', 'Agents you own directly, outside any organization.')}</p>
    </div>
    <a
      href="/app/agents/new"
      class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >{t('my-agents.new', 'New agent')}</a>
  </div>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('my-agents.load-failed', "Couldn't load your agents just now — this is a temporary error, not an empty list. Try refreshing the page.")}
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-agents.empty', "You don't have any personal agents yet.")}</p>
      <a href="/app/agents/new" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('my-agents.empty-cta', 'Create your first agent')}</a>
    </div>
  {:else}
    <DataTable
      {table}
      listKey="agents:mine"
      searchPlaceholder={t('my-agents.search', 'Search agents…')}
      searchAriaLabel={t('my-agents.search', 'Search agents…')}
      bind:globalFilter
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <a href="/app/agents/{row.id}" class="inline-block max-w-full truncate align-bottom font-medium text-indigo-600 hover:underline dark:text-indigo-300" title={row.name}>{row.name}</a>
        {:else if cell.column.id === 'urn'}
          <Urn value={row.urn} type="agent" size={8} />
        {:else if cell.column.id === 'visibility'}
          <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{visibilityLabel(row.visibility)}</span>
        {:else if cell.column.id === 'description'}
          <div class="truncate">{row.description || '—'}</div>
        {:else}
          <div class="truncate">{cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
