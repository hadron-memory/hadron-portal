<!--
  Org agents list — TanStack grid (@tanstack/table-core + the Svelte 5
  runes adapter, src/lib/table/*), same chrome conventions as
  /app/usage/sessions and /app/account/api-keys (PR #293/#294).

  009-install-agent-flow T012's no-nested-interactive constraint carries
  over naturally: the name link and the Install button live in separate
  cells, so neither wraps the other.
-->
<script lang="ts">
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
  import { installStrings } from '$lib/i18n/install-strings';
  import type { Agent } from '$lib/types';
  import type { AgentGrant } from './+page.server';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
  const agents = $derived(org.agents ?? []);
  // agentId → the App it's installed as (id + name), for the "Open" affordance.
  const installedByAgent = $derived(data.installedByAgent ?? {});
  // #486: cross-org AgentOrgGrants; null = fetch failed (≠ empty).
  const subscribedGrants = $derived(data.subscribedGrants);

  // ── Tabs (#486): the org's own agents vs its subscriptions ───────────
  let activeTab = $state<'own' | 'subscribed'>('own');

  let globalFilter = $state('');

  const columns: ColumnDef<Agent>[] = [
    { accessorKey: 'name', header: t('org-agents.column.name', 'Name'), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: t('org-agents.column.urn', 'URN'), size: 280 },
    { accessorKey: 'description', header: t('org-agents.column.description', 'Description'), size: 280 },
    // +1 for the agent's own system memory (when it has one) — it isn't part
    // of memoryItems. Agents without a system memory count only memoryItems.
    { accessorFn: (row) => row.memoryItems.length + (row.systemMemoryId ? 1 : 0), id: 'memories', header: t('org-agents.column.memories', 'Memories'), size: 100 },
    { id: 'actions', header: t('org-agents.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 170 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    description: (v) => (v as string | null) ?? '—',
  };

  const table = createSvelteTable<Agent>({
    get data() {
      return agents;
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

  // ── Subscribed tab table (#486) ───────────────────────────────────────
  /** Owning org's slug out of a canonical agent URN (hrn:agent:<org>::<slug>). */
  function ownerSlugOf(urn: string): string {
    const bare = urn.replace(/^(hrn|urn):agent:/, '');
    const sep = bare.indexOf('::');
    return sep >= 0 ? bare.slice(0, sep) : bare;
  }

  // Lifecycle as a structural kind + a localized label, kept apart so the
  // status-chip styling keys off the KIND — never the translated string
  // (PR-494 review: label comparison breaks under any non-English locale).
  type GrantStatusKind = 'active' | 'revoked' | 'expired' | 'pending';
  function grantStatusKind(g: AgentGrant): GrantStatusKind {
    if (g.revokedAt) return 'revoked';
    if (g.expiresAt && new Date(g.expiresAt).getTime() < Date.now()) return 'expired';
    return g.isActive ? 'active' : 'pending';
  }
  const grantStatusLabel: Record<GrantStatusKind, string> = {
    active: t('org-agents.subscribed.status.active', 'Active'),
    revoked: t('org-agents.subscribed.status.revoked', 'Revoked'),
    expired: t('org-agents.subscribed.status.expired', 'Expired'),
    pending: t('org-agents.subscribed.status.pending', 'Pending'),
  };

  // Pin locale AND timezone so SSR and client format identically — the
  // server may run in UTC while the browser doesn't (PR-494 review).
  function fmtDate(s: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  let grantsFilter = $state('');

  const grantColumns: ColumnDef<AgentGrant>[] = [
    { accessorFn: (g) => g.agent?.name ?? g.agentId, id: 'name', header: t('org-agents.subscribed.column.name', 'Name'), enableHiding: false, size: 200 },
    { accessorFn: (g) => g.agent?.urn ?? '', id: 'urn', header: t('org-agents.subscribed.column.urn', 'URN'), size: 280 },
    { accessorFn: (g) => (g.agent ? ownerSlugOf(g.agent.urn) : '—'), id: 'owner', header: t('org-agents.subscribed.column.owner', 'Owner'), size: 140 },
    { accessorFn: (g) => grantStatusLabel[grantStatusKind(g)], id: 'status', header: t('org-agents.subscribed.column.status', 'Status'), size: 100 },
    { accessorFn: (g) => g.activatedAt ?? g.createdAt, id: 'since', header: t('org-agents.subscribed.column.since', 'Since'), size: 120 },
  ];

  const grantsTable = createSvelteTable<AgentGrant>({
    get data() {
      return subscribedGrants ?? [];
    },
    columns: grantColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return grantsFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      grantsFilter = typeof u === 'function' ? u(grantsFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
</script>

<svelte:head><title>Agents · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-start justify-between">
    <div>
      <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Agents</h1>
      <p class="text-sm text-zinc-500">Group memories into agents for app subscriptions.</p>
    </div>
    <div class="flex items-center gap-2">
      {#if activeTab === 'own'}
        <a href="/app/orgs/{org.id}/agents/new" class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          New Agent
        </a>
      {/if}
    </div>
  </div>

  <!-- Own vs Subscribed (#486). Subscribed = the org's AgentOrgGrants for
       agents owned by OTHER orgs. -->
  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    <button
      type="button"
      class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'own' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
      onclick={() => (activeTab = 'own')}
    >{t('org-agents.tab.own', 'Organization agents')}</button>
    <button
      type="button"
      class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'subscribed' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
      onclick={() => (activeTab = 'subscribed')}
    >{t('org-agents.tab.subscribed', 'Subscribed')}
      {#if subscribedGrants && subscribedGrants.length > 0}
        <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{subscribedGrants.length}</span>
      {/if}
    </button>
  </div>

  {#if activeTab === 'subscribed'}
    {#if subscribedGrants === null}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('org-agents.subscribed.unavailable', 'Subscriptions couldn’t be loaded — try again in a moment.')}
      </div>
    {:else if subscribedGrants.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
          {t('org-agents.subscribed.empty.title', 'No subscriptions to agents from other organizations.')}
        </p>
        <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
          {t(
            'org-agents.subscribed.empty.explainer',
            'A subscription is created when this organization installs an agent owned by another organization. Only organization admins can see subscriptions. Browsing and subscribing to public agents from here is coming soon.',
          )}
        </p>
      </div>
    {:else}
      <DataTable
        table={grantsTable}
        listKey="orgs:subscribed-agents"
        searchPlaceholder={t('org-agents.subscribed.search.placeholder', 'Search subscriptions...')}
        searchAriaLabel={t('org-agents.subscribed.search.aria-label', 'Search subscriptions')}
        bind:globalFilter={grantsFilter}
        maxHeight="max(200px, calc(100vh - 25rem))"
      >
        {#snippet cell(cell, grant)}
          {#if cell.column.id === 'urn'}
            {#if grant.agent}
              <Urn value={grant.agent.urn} type="agent" size={8} />
            {:else}
              —
            {/if}
          {:else if cell.column.id === 'status'}
            {@const kind = grantStatusKind(grant)}
            <span class="rounded-full px-2 py-0.5 text-xs font-medium {kind === 'active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{grantStatusLabel[kind]}</span>
          {:else if cell.column.id === 'since'}
            <span class="whitespace-nowrap">{fmtDate(grant.activatedAt ?? grant.createdAt)}</span>
          {:else}
            <div class="truncate">{cell.getValue()}</div>
          {/if}
        {/snippet}
      </DataTable>
    {/if}
  {:else if agents.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No agents yet. <a href="/app/orgs/{org.id}/agents/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one →</a>
    </div>
  {:else}
    <!-- 25rem offset tuned to this page's chrome height. -->
    <DataTable
      {table}
      listKey="orgs:agents"
      searchPlaceholder={t('org-agents.search.placeholder', 'Search agents...')}
      searchAriaLabel={t('org-agents.search.aria-label', 'Search agents')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 25rem))"
    >
      {#snippet cell(cell, agent)}
        {#if cell.column.id === 'name'}
          <div class="truncate">
            <a href="/app/orgs/{org.id}/agents/{agent.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{agent.name}</a>
          </div>
        {:else if cell.column.id === 'urn'}
          <Urn value={agent.urn} type="agent" size={8} />
        {:else if cell.column.id === 'actions'}
          {@const installed = installedByAgent[agent.id]}
          <div class="flex items-center gap-2">
            {#if installed}
              <a
                href="/app/orgs/{org.id}/apps/{installed.appId}"
                title={t('org-agents.action.open-title', 'Open the app this agent is installed as')}
                class="inline-block rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('org-agents.action.open', 'Open')}
              </a>
            {/if}
            <a
              href="/app/orgs/{org.id}/agents/install/{agent.id}"
              class="inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style="background: #fb8500;"
            >
              {installStrings.buttonLabel()}
            </a>
          </div>
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
