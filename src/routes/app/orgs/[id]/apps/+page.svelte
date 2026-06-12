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
  import ViewTabs from '$lib/components/table/ViewTabs.svelte';
  import ColumnToggle from '$lib/components/table/ColumnToggle.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { tableStrings } from '$lib/i18n/table-strings';
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

  const pageSize = $derived(table.getState().pagination.pageSize);
  const pageIndex = $derived(table.getState().pagination.pageIndex);
  const pageCount = $derived(table.getPageCount());

  function sortIndicator(state: false | 'asc' | 'desc'): string {
    return state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⇅';
  }
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
    <!-- Saved-views tab strip -->
    <ViewTabs {table} listKey="orgs:apps" />

    <!-- Filter + columns -->
    <div class="flex items-center gap-4">
      <input type="text" placeholder={t('org-apps.search.placeholder', 'Search apps...')} aria-label={t('org-apps.search.aria-label', 'Search apps')} bind:value={globalFilter}
        class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      <ColumnToggle {table} />
    </div>

    <!-- Bounded, internally-scrolling container so the page itself doesn't
         scroll and the pagination footer below stays visible. The `<thead>`
         is sticky so column headers remain while the body scrolls. The 200px
         floor keeps the body visible on short viewports. The 25rem offset is
         tuned per page to this page's chrome height (taller header with lead
         paragraph than sessions/api-keys, which use 23rem) — same convention
         as the other grids. -->
    <div class="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800" style="max-height: max(200px, calc(100vh - 25rem));">
      <table class="text-sm" style="table-layout: fixed; width: max(100%, {table.getCenterTotalSize()}px);">
        <thead>
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {#each headerGroup.headers as header (header.id)}
                <th
                  class="sticky top-0 z-10 select-none border-b border-r last:border-r-0 border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900 {header.column.getCanSort() ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200' : ''}"
                  style="width: {header.getSize()}px;"
                  tabindex={header.column.getCanSort() ? 0 : undefined}
                  aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}
                  onclick={header.column.getToggleSortingHandler()}
                  onkeydown={(e) => {
                    if (header.column.getCanSort() && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      header.column.getToggleSortingHandler()?.(e);
                    }
                  }}
                >
                  <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 truncate">{header.column.columnDef.header}</span>
                    {#if header.column.getCanSort()}
                      <span class={header.column.getIsSorted() ? 'text-indigo-500' : 'text-zinc-300 dark:text-zinc-700'}>{sortIndicator(header.column.getIsSorted())}</span>
                    {/if}
                  </div>
                  {#if header.column.getCanResize()}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-indigo-400 {header.column.getIsResizing() ? 'bg-indigo-500' : ''}"
                      onmousedown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      ontouchstart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                      onclick={(e) => e.stopPropagation()}
                    ></div>
                  {/if}
                </th>
              {/each}
            </tr>
          {/each}
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each table.getRowModel().rows as row (row.id)}
            {@const app = row.original}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              {#each row.getVisibleCells() as cell (cell.id)}
                <td class="border-r last:border-r-0 border-zinc-200 px-4 py-2.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
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
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Footer: page size (left of Prev/Next) + pagination; always visible -->
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-zinc-500">{pageCount > 1 ? tableStrings.pageOf(pageIndex + 1, pageCount) : ''}</span>
      <div class="flex items-center gap-2">
        <select value={pageSize} onchange={(e) => table.setPageSize(Number((e.target as HTMLSelectElement).value))}
          aria-label={tableStrings.rowsPerPage()}
          class="rounded-lg border border-zinc-300 !bg-zinc-100 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:!bg-zinc-800 dark:text-white">
          {#each [10, 20, 50, 100] as size}
            <option value={size}>{tableStrings.perPage(size)}</option>
          {/each}
        </select>
        {#if pageCount > 1}
          <button disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.previous()}</button>
          <button disabled={!table.getCanNextPage()} onclick={() => table.nextPage()}
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{tableStrings.next()}</button>
        {/if}
      </div>
    </div>
  {/if}
</div>
