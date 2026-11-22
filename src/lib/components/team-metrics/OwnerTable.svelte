<!-- portal#1856 — started owned tasks by owner, then by project: a DataTable, one row per owner and project. -->
<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import CountDrill from './CountDrill.svelte';
  import ProjectName from './ProjectName.svelte';
  import type { MetricsCount, MetricsOwnerGroup, MetricsProject } from '$lib/team-metrics/types';

  type Row = { key: string; owner: MetricsOwnerGroup['owner']; ownerTotal: MetricsCount; project: MetricsProject; tasks: MetricsCount; ownerName: string; projectName: string };

  let { owners, appId }: { owners: MetricsOwnerGroup[]; appId: string } = $props();

  const unknownOwner = t('team-metrics.owner.unknown', 'Owner not shown');
  const rows: Row[] = $derived(
    owners.flatMap((g, i) =>
      g.byProject.map((p, j) => ({
        key: `${i}:${j}`, owner: g.owner, ownerTotal: g.tasks, project: p.project, tasks: p.tasks,
        ownerName: g.owner?.name ?? unknownOwner,
        projectName: p.project.noProject ? t('team-metrics.project.none', 'No project') : (p.project.title ?? p.project.handle),
      })),
    ),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'ownerName', header: t('team-metrics.col.owner', 'Owner'), enableHiding: false, size: 260 },
    { accessorFn: (r) => r.ownerTotal.total, id: 'ownerTotal', header: t('team-metrics.col.owner-total', 'All by this owner'), size: 150 },
    { accessorKey: 'projectName', header: t('team-metrics.col.project', 'Project'), size: 280 },
    { accessorFn: (r) => r.tasks.total, id: 'tasks', header: t('team-metrics.col.tasks', 'Tasks'), size: 110 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({}, { ownerName: (r) => r.owner?.urn ?? '', projectName: (r) => r.project.handle }),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

<DataTable
  {table}
  listKey="app:team-metrics:started-owned"
  bind:globalFilter
  bounded
  searchPlaceholder={t('team-metrics.owners.search', 'Search owners and projects…')}
  searchAriaLabel={t('team-metrics.owners.search.aria', 'Search started tasks by owner or project')}
  rowAttrs={() => ({ 'data-testid': 'metrics-owner-row' })}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'ownerName'}
      <div class="min-w-0">
        <div class="truncate font-medium text-zinc-900 dark:text-white">{row.ownerName}</div>
        {#if row.owner?.urn}<div class="mt-1"><Urn value={row.owner.urn} type="worker" size={8} /></div>{/if}
      </div>
    {:else if c.column.id === 'ownerTotal'}
      <CountDrill count={row.ownerTotal} kind="task" {appId} label={t('team-metrics.label.owner-total', 'tasks by {owner}', { owner: row.ownerName })} />
    {:else if c.column.id === 'projectName'}
      <ProjectName project={row.project} {appId} />
    {:else if c.column.id === 'tasks'}
      <CountDrill count={row.tasks} kind="task" {appId} label={t('team-metrics.label.owner-project', 'tasks by {owner} in {project}', { owner: row.ownerName, project: row.projectName })} />
    {/if}
  {/snippet}
</DataTable>
