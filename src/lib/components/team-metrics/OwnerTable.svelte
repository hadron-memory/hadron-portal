<!-- portal#1856 — started owned tasks by owner: a DataTable, ONE row per owner, the by-project breakdown inside the row. -->
<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import CountDrill from './CountDrill.svelte';
  import ProjectName from './ProjectName.svelte';
  import type { MetricsOwnerGroup } from '$lib/team-metrics/types';

  type Row = MetricsOwnerGroup & { ownerName: string; projectNames: string };

  let { owners, appId }: { owners: MetricsOwnerGroup[]; appId: string } = $props();

  const unknownOwner = t('team-metrics.owner.unknown', 'Owner not shown');
  const projectName = (p: MetricsOwnerGroup['byProject'][number]['project']) =>
    p.noProject ? t('team-metrics.project.none', 'No project') : (p.title ?? p.handle);
  const rows: Row[] = $derived(
    owners.map((g) => ({ ...g, ownerName: g.owner?.name ?? unknownOwner, projectNames: g.byProject.map((p) => `${projectName(p.project)} ${p.project.handle}`).join(' ') })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'ownerName', header: t('team-metrics.col.owner', 'Owner'), enableHiding: false, size: 260 },
    { accessorFn: (r) => r.tasks.total, id: 'tasks', header: t('team-metrics.col.tasks', 'Tasks'), size: 90 },
    { accessorKey: 'projectNames', header: t('team-metrics.col.by-project', 'By project'), size: 480, enableSorting: false },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({}, { ownerName: (r) => r.owner?.urn ?? '' }),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
</script>

{#snippet projects(row: Row)}
  <ul class="space-y-2">
    {#each row.byProject as p (p.project.handle + (p.project.noProject ? ':none' : ''))}
      <li class="flex items-baseline justify-between gap-3">
        <ProjectName project={p.project} {appId} />
        <CountDrill count={p.tasks} kind="task" {appId} label={t('team-metrics.label.owner-project', 'tasks by {owner} in {project}', { owner: row.ownerName, project: projectName(p.project) })} />
      </li>
    {/each}
  </ul>
{/snippet}

<DataTable
  {table}
  listKey="app:team-metrics:started-owned"
  bind:globalFilter
  contentHeight
  showPageSize={false}
  phoneHiddenColumns={['projectNames']}
  searchPlaceholder={t('team-metrics.owners.search', 'Search owners and projects…')}
  searchAriaLabel={t('team-metrics.owners.search.aria', 'Search started tasks by owner or project')}
  rowAttrs={() => ({ 'data-testid': 'metrics-owner-row' })}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'ownerName'}
      <div class="min-w-0">
        <div class="truncate font-medium text-zinc-900 dark:text-white">{row.ownerName}</div>
        {#if row.owner?.urn}<div class="mt-1"><Urn value={row.owner.urn} type="worker" size={8} /></div>{/if}
        <div class="mt-3 sm:hidden" data-testid="metrics-owner-projects-phone">{@render projects(row)}</div>
      </div>
    {:else if c.column.id === 'tasks'}
      <CountDrill count={row.tasks} kind="task" {appId} label={t('team-metrics.label.owner-total', 'tasks by {owner}', { owner: row.ownerName })} />
    {:else if c.column.id === 'projectNames'}
      {@render projects(row)}
    {/if}
  {/snippet}
</DataTable>
