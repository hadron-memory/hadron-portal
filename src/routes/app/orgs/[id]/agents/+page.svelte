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
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
  const agents = $derived(org.agents ?? []);

  let globalFilter = $state('');

  const columns: ColumnDef<Agent>[] = [
    { accessorKey: 'name', header: t('org-agents.column.name', 'Name'), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: t('org-agents.column.urn', 'URN'), size: 280 },
    { accessorKey: 'description', header: t('org-agents.column.description', 'Description'), size: 280 },
    { accessorFn: (row) => row.memoryItems.length, id: 'memories', header: t('org-agents.column.memories', 'Memories'), size: 100 },
    { id: 'actions', header: t('org-agents.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 110 },
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


</script>

<svelte:head><title>Agents · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-start justify-between">
    <div>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">Agents</h2>
      <p class="text-sm text-zinc-500">Group memories into agents for app subscriptions.</p>
    </div>
    <div class="flex items-center gap-2">
      <a href="/app/orgs/{org.id}/create-chatbot" class="rounded-lg px-4 py-2 text-sm font-medium text-white" style="background: #fb8500;">
        New Chatbot Agent
      </a>
      <a href="/app/orgs/{org.id}/agents/new" class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        New Agent
      </a>
    </div>
  </div>

  {#if agents.length === 0}
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
          <a
            href="/app/orgs/{org.id}/agents/install/{agent.id}"
            class="inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style="background: #fb8500;"
          >
            {installStrings.buttonLabel()}
          </a>
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
