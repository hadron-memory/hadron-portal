<script lang="ts">
  // "Task Nodes" — runnable nodes in the active org's memories. Uses the shared
  // DataTable chrome (search + saved-views "+ view" + Columns on one row, sticky
  // sortable/resizable header, pagination footer) — same component and layout as
  // the org memories page — instead of a bespoke table. A name click opens the
  // node via the /app/u resolver.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);

  interface TaskRow {
    id: string;
    loc: string;
    name: string;
    description: string;
    urn: string;
  }

  // `nodeType` is intentionally absent — every row is a task, so a type chip
  // would be redundant noise.
  const rows = $derived<TaskRow[]>(
    data.tasks.map((task) => ({
      id: task.id,
      loc: task.loc,
      name: task.name,
      description: task.description ?? '',
      urn: task.urn,
    })),
  );

  let globalFilter = $state('');

  const columns: PortalColumnDef<TaskRow>[] = [
    { accessorKey: 'name', header: t('tasks.column.name', 'Name'), enableHiding: false, size: 320 }, // identity column
    { accessorKey: 'description', header: t('tasks.column.description', 'Description'), size: 520 },
  ];

  const table = createSvelteTable<TaskRow>({
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
  });
</script>

<svelte:head><title>Task Nodes · {org?.name ?? ''} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">{t('tasks.title', 'Task Nodes')}</h1>
    <p class="mt-1 text-sm text-zinc-500">
      {t('tasks.description', 'Every runnable node (a task) in this organization’s memories.')}
    </p>
  </div>

  {#if data.failed}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {t('tasks.failed', 'Couldn’t load tasks — the node query failed. Try again shortly.')}
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      {t('tasks.empty', 'No runnable nodes in this organization’s memories.')}
    </div>
  {:else}
    {#if data.truncated}
      <p class="text-sm text-amber-600 dark:text-amber-400">
        {t('tasks.truncated', 'Showing the first {count} tasks.', { count: rows.length })}
      </p>
    {/if}

    <DataTable
      {table}
      listKey="orgs:tasks"
      searchPlaceholder={t('tasks.search-placeholder', 'Search tasks by name or description…')}
      searchAriaLabel={t('tasks.search.aria-label', 'Search tasks')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 20rem))"
    >
      {#snippet cell(cell, task)}
        {#if cell.column.id === 'name'}
          <div class="min-w-0">
            <a href="/app/u/{task.urn}" class="block truncate font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{task.name}</a>
            <div class="mt-0.5"><Urn value={task.urn} type="node" size={8} /></div>
          </div>
        {:else if cell.column.id === 'description'}
          <div class="line-clamp-2">{task.description || '—'}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
