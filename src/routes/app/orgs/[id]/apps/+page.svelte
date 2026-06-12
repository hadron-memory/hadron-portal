<!--
  Org apps list — TanStack grid (@tanstack/table-core + the Svelte 5
  runes adapter, src/lib/table/*), same chrome conventions as
  /app/usage/sessions and /app/account/api-keys (PR #293/#294).

  009-install-agent-flow FR-011 / T019 still holds: this page is
  list-only; the empty state directs the user to the Agents list to
  install, and creation happens via the install flow.
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
  import { installStrings } from '$lib/i18n/install-strings';
  import type { App } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const apps = $derived(data.apps);

  function activeKeyCount(app: App): number {
    return app.keys.filter((k) => !k.revokedAt).length;
  }

  let globalFilter = $state('');

  const columns: ColumnDef<App>[] = [
    { accessorKey: 'name', header: t('org-apps.column.name', 'Name'), enableHiding: false, size: 180 }, // identity column
    { accessorKey: 'urn', header: t('org-apps.column.urn', 'URN'), size: 260 },
    { accessorFn: (row) => row.agent?.name ?? null, id: 'agent', header: t('org-apps.column.agent', 'Agent'), size: 150 },
    { accessorKey: 'identifyUserMethod', header: t('org-apps.column.identify-users', 'Identify users'), size: 120 },
    { accessorKey: 'createUserPermission', header: t('org-apps.column.create-users', 'Create users'), size: 120 },
    { accessorFn: (row) => activeKeyCount(row), id: 'activeKeys', header: t('org-apps.column.active-keys', 'Active keys'), size: 100 },
    { accessorKey: 'sessionTimeoutSeconds', header: t('org-apps.column.session-timeout', 'Session timeout'), size: 130 },
    { accessorKey: 'anonymousTtlDays', header: t('org-apps.column.anon-ttl', 'Anon TTL'), size: 90 },
    { id: 'actions', header: t('org-apps.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 150 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    agent: (v) => (v as string | null) ?? '—',
    sessionTimeoutSeconds: (v) => (typeof v === 'number' ? `${Math.round(v / 60)}m` : '—'),
    anonymousTtlDays: (v) => (v != null ? `${v}d` : '—'),
  };

  const table = createSvelteTable<App>({
    get data() {
      return apps;
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

<svelte:head><title>Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Apps' },
    ]} />
    <div class="mt-2">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Apps</h1>
      <p class="mt-1 text-sm text-zinc-500">Installed Agents that authenticate clients (Micromentor, websites, mobile apps, the coding-agent CLI). Each App is a deployment of an Agent.</p>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{form.error}</div>
  {/if}

  {#if apps.length === 0}
    <!-- 009-install-agent-flow FR-011 / T019: Apps page is list-only.
         Empty-state copy directs the user to the Agents list to install. -->
    <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <p class="text-sm text-zinc-500">{installStrings.emptyAppsPage()}</p>
      <a href="/app/orgs/{org.id}/agents" class="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
        Browse Agents
      </a>
    </div>
  {:else}
    <!-- 25rem offset tuned to this page's chrome height (taller header
         with lead paragraph than sessions/api-keys). -->
    <DataTable
      {table}
      listKey="orgs:apps"
      searchPlaceholder={t('org-apps.search.placeholder', 'Search apps...')}
      searchAriaLabel={t('org-apps.search.aria-label', 'Search apps')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 25rem))"
    >
      {#snippet cell(cell, app)}
        {#if cell.column.id === 'name'}
          <div class="truncate">
            <a href="/app/orgs/{org.id}/apps/{app.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{app.name}</a>
          </div>
        {:else if cell.column.id === 'urn'}
          <Urn value={app.urn} type="app" size={8} />
        {:else if cell.column.id === 'identifyUserMethod' || cell.column.id === 'createUserPermission'}
          <span class="inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{cell.getValue()}</span>
        {:else if cell.column.id === 'actions'}
          <div class="flex items-center gap-2">
            <a href="/app/orgs/{org.id}/apps/{app.id}"
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Manage
            </a>
            <form method="POST" action="?/delete" use:enhance
              onsubmit={(e) => { if (!confirm(`Delete app "${app.name}"? Active keys will be revoked and sessions invalidated.`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={app.id} />
              <button type="submit" class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                Delete
              </button>
            </form>
          </div>
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
