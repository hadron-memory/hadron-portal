<!-- portal#1856 — started projects and their direct children counted by status: a DataTable, one row per project. -->
<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import CountDrill from './CountDrill.svelte';
  import ProjectName from './ProjectName.svelte';
  import type { MetricsProjects } from '$lib/team-metrics/types';

  type Row = MetricsProjects['items'][number] & { projectName: string };

  let { items, appId }: { items: MetricsProjects['items']; appId: string } = $props();

  const rows: Row[] = $derived(items.map((i) => ({ ...i, projectName: i.project.noProject ? t('team-metrics.project.none', 'No project') : (i.project.title ?? i.project.handle) })));

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'projectName', header: t('team-metrics.col.project', 'Project'), enableHiding: false, size: 300 },
    { accessorFn: (r) => r.children.reduce((n, c) => n + c.tasks.total, 0), id: 'children', header: t('team-metrics.col.children', 'Direct tasks by status'), size: 460 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({}, { projectName: (r) => r.project.handle }),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  listKey="app:team-metrics:projects"
  bind:globalFilter
  bounded
  searchPlaceholder={t('team-metrics.projects.search', 'Search projects…')}
  searchAriaLabel={t('team-metrics.projects.search.aria', 'Search started projects')}
  rowAttrs={() => ({ 'data-testid': 'metrics-project-row' })}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'projectName'}
      <ProjectName project={row.project} {appId} />
    {:else if c.column.id === 'children'}
      {#if row.children.length === 0}
        <span class="text-sm text-zinc-500 dark:text-zinc-400">{t('team-metrics.projects.no-children', 'No tasks under it')}</span>
      {:else}
        <ul class="flex flex-wrap gap-x-4 gap-y-2">
          {#each row.children as ch (ch.status)}
            <li class="flex items-baseline gap-1.5 text-sm">
              <span class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{ch.status}</span>
              <CountDrill count={ch.tasks} kind="task" {appId} label={t('team-metrics.label.child-status', '{status} tasks in {project}', { status: ch.status, project: row.projectName })} />
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/snippet}
</DataTable>
