<!--
  portal#1316 (hadron-server#2061 / #2475) — the Composition view: who reports
  to whom on this App's team, and how many of each role and family each
  coordinator has, exactly as `teamComposition` returned them.

  The user wants to see the shape of the team without joining the roster
  against the worker list. So the page does no joining and no counting: lanes
  and workers keep the server's order (the tables start unsorted), the
  headcounts are the server's, and a lane is a DIRECT-report group, never a
  rollup. A coordinator's own row sits in the lane of whoever it reports to.

  Null is a bucket the server returned, not missing data: a null coordinator is
  the Unassigned lane, a null role or family is "No role" / "No family", each
  counted on its own. Bound and live session are two facts and neither is
  presented as availability or permission. A known empty team, a failed read
  and a withheld read are three different things, as on the Roster.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import { partySearchText, WORKER_CHIP_COLUMN_PX } from '$lib/agent-tasks/status';
  import { rosterStateChipClass, rosterStateLabel } from '$lib/agent-tasks/roster';
  import type { TaskRead, TeamComposition, TeamCompositionLane, TeamCompositionWorker } from '$lib/agent-tasks/types';
  import NotParticipant from './NotParticipant.svelte';
  import PartyLabel from './PartyLabel.svelte';

  let {
    composition,
    basePath,
    impersonating = null,
  }: { composition: TaskRead<TeamComposition>; basePath: string; impersonating?: string | null } = $props();

  const noRole = () => t('app.tasks.composition.no-role', 'No role');
  const noFamily = () => t('app.tasks.composition.no-family', 'No family');
  const roleLabel = (role: string | null) => role ?? noRole();
  const familyLabel = (family: string | null) => family ?? noFamily();
  const unassigned = () => t('app.tasks.composition.unassigned', 'Unassigned');
  const retired = () => t('app.tasks.roster.retired', '(retired)');
  // The (retired) marker is on screen, so the search has to find it (#1317 LOCAL).
  const coordinatorText = (lane: TeamCompositionLane) =>
    lane.coordinator ? `${partySearchText(lane.coordinator)}${lane.coordinatorRetired ? ` ${retired()}` : ''}` : unassigned();
  const yesNo = (v: boolean) => (v ? t('app.tasks.composition.yes', 'Yes') : t('app.tasks.composition.no', 'No'));

  interface LaneRow {
    lane: TeamCompositionLane;
    coordinator: string;
    roles: string;
    roleFamilies: string;
  }
  interface WorkerRow {
    lane: TeamCompositionLane;
    member: TeamCompositionWorker;
    coordinator: string;
    worker: string;
    role: string;
    family: string;
    bound: string;
    liveSession: string;
    state: string;
  }

  const lanes = $derived(composition.kind === 'ok' ? composition.value.lanes : []);

  const laneRows = $derived<LaneRow[]>(
    lanes.map((lane) => ({
      lane,
      coordinator: coordinatorText(lane),
      roles: lane.countsByRole.map((c) => `${roleLabel(c.role)} ${c.count}`).join(' '),
      roleFamilies: lane.countsByRoleFamily.map((c) => `${roleLabel(c.role)} ${familyLabel(c.family)} ${c.count}`).join(' '),
    })),
  );

  // Flattened in lane order, and within a lane in the order the server sent.
  const workerRows = $derived<WorkerRow[]>(
    lanes.flatMap((lane) =>
      lane.workers.map((member) => ({
        lane,
        member,
        coordinator: coordinatorText(lane),
        worker: partySearchText(member.worker),
        role: roleLabel(member.role),
        family: familyLabel(member.family),
        bound: yesNo(member.bound),
        liveSession: yesNo(member.liveSession),
        state: rosterStateLabel(member.state),
      })),
    ),
  );

  let laneFilter = $state('');
  let workerFilter = $state('');

  const laneColumns: PortalColumnDef<LaneRow>[] = [
    { id: 'coordinator', accessorFn: (r) => r.coordinator, header: t('app.tasks.composition.col.coordinator', 'Coordinator'), enableHiding: false, enableSorting: false, size: WORKER_CHIP_COLUMN_PX },
    { id: 'roles', accessorFn: (r) => r.roles, header: t('app.tasks.composition.col.roles', 'Headcount by role'), enableSorting: false, size: 300 },
    { id: 'roleFamilies', accessorFn: (r) => r.roleFamilies, header: t('app.tasks.composition.col.role-families', 'Headcount by role and family'), enableSorting: false, size: 380 },
  ];
  const laneTable = createSvelteTable<LaneRow>({
    get data() { return laneRows; },
    columns: laneColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return laneFilter; } },
    onGlobalFilterChange: (u) => { laneFilter = typeof u === 'function' ? u(laneFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<LaneRow>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [] },
  });

  const workerColumns: PortalColumnDef<WorkerRow>[] = [
    { id: 'worker', accessorFn: (r) => r.worker, header: t('app.tasks.composition.col.worker', 'Worker'), enableHiding: false, enableSorting: false, size: WORKER_CHIP_COLUMN_PX },
    { id: 'coordinator', accessorFn: (r) => r.coordinator, header: t('app.tasks.composition.col.reports-to', 'Reports to'), enableSorting: false, size: 190 },
    { id: 'role', accessorFn: (r) => r.role, header: t('app.tasks.composition.col.role', 'Role'), enableSorting: false, size: 150 },
    { id: 'family', accessorFn: (r) => r.family, header: t('app.tasks.composition.col.family', 'Family'), enableSorting: false, size: 120 },
    { id: 'bound', accessorFn: (r) => r.bound, header: t('app.tasks.composition.col.bound', 'Bound'), enableSorting: false, size: 90 },
    { id: 'liveSession', accessorFn: (r) => r.liveSession, header: t('app.tasks.composition.col.live-session', 'Live session'), enableSorting: false, size: 120 },
    { id: 'state', accessorFn: (r) => r.state, header: t('app.tasks.composition.col.state', 'State'), enableSorting: false, size: 180 },
  ];
  const workerTable = createSvelteTable<WorkerRow>({
    get data() { return workerRows; },
    columns: workerColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return workerFilter; } },
    onGlobalFilterChange: (u) => { workerFilter = typeof u === 'function' ? u(workerFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<WorkerRow>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 50 }, sorting: [] },
  });

  let refreshing = $state(false);
  let refreshFailed = $state(false);
  async function refresh() {
    refreshing = true;
    refreshFailed = false;
    try {
      await invalidateAll();
    } catch {
      refreshFailed = true;
    } finally {
      refreshing = false;
    }
  }
</script>

{#if composition.kind === 'not-participant'}
  <NotParticipant {impersonating} />
{:else if composition.kind === 'failed'}
  <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
    {t('app.tasks.composition.failed', 'Couldn’t load the composition.')}
    <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tasks.retry', 'Try again')}</button>
  </div>
{:else}
  <div class="space-y-6">
    <div class="flex items-center justify-end gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      {#if refreshFailed}<span role="alert" class="text-red-700 dark:text-red-300">{t('app.tasks.composition.refresh-failed', 'Couldn’t refresh.')}</span>{/if}
      <span>{t('app.tasks.roster.as-of', 'As of {time}', { time: fmtRunTime(composition.value.asOf) })}</span>
      <button
        type="button"
        onclick={refresh}
        disabled={refreshing}
        class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{t('app.tasks.refresh', 'Refresh')}</button>
    </div>

    {#if lanes.length === 0}
      <div class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
        {t('app.tasks.roster.empty', 'No workers on this App’s roster.')}
      </div>
    {:else}
      <section class="space-y-2" aria-labelledby="composition-lanes">
        <h2 id="composition-lanes" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.composition.lanes', 'Lanes')}</h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.composition.lanes.note', 'Each lane is one coordinator’s direct reports, not a rollup. A coordinator’s own row is in the lane of whoever they report to. Unassigned holds workers with no coordinator.')}</p>
        <DataTable
          table={laneTable}
          listKey="app-tasks:composition-lanes"
          searchPlaceholder={t('app.tasks.composition.lanes.search', 'Search the lanes…')}
          searchAriaLabel={t('app.tasks.composition.lanes.search', 'Search the lanes…')}
          bind:globalFilter={laneFilter}
          bounded
          rowAttrs={(r) => ({ 'data-lane': r.lane.coordinator?.id ?? 'unassigned' })}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'coordinator'}
              <span class="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1">
                {#if row.lane.coordinator}
                  <PartyLabel party={row.lane.coordinator} />
                  {#if row.lane.coordinatorRetired}<span class="text-xs text-zinc-500 dark:text-zinc-400">{retired()}</span>{/if}
                {:else}
                  <span class="text-zinc-600 dark:text-zinc-300">{unassigned()}</span>
                {/if}
              </span>
            {:else if cell.column.id === 'roles'}
              <span class="flex flex-wrap gap-1.5">
                {#each row.lane.countsByRole as c (JSON.stringify(c.role))}
                  <span data-count-role={c.role ?? ''} class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{roleLabel(c.role)} · {c.count}</span>
                {/each}
              </span>
            {:else}
              <span class="flex flex-wrap gap-1.5">
                {#each row.lane.countsByRoleFamily as c (JSON.stringify([c.role, c.family]))}
                  <span data-count-role-family={JSON.stringify([c.role, c.family])} class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{roleLabel(c.role)} / {familyLabel(c.family)} · {c.count}</span>
                {/each}
              </span>
            {/if}
          {/snippet}
        </DataTable>
      </section>

      <section class="space-y-2" aria-labelledby="composition-workers">
        <h2 id="composition-workers" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.composition.workers', 'Workers')}</h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.composition.workers.note', 'Workers in lane order, as the server sent them: consecutive rows with the same Reports to are one lane. Bound means a person or agent has taken the worker’s seat; Live session means it is running now.')}</p>
        <DataTable
          table={workerTable}
          listKey="app-tasks:composition-workers"
          searchPlaceholder={t('app.tasks.composition.workers.search', 'Search the workers…')}
          searchAriaLabel={t('app.tasks.composition.workers.search', 'Search the workers…')}
          bind:globalFilter={workerFilter}
          bounded
          rowAttrs={(r) => ({ 'data-worker': r.member.worker.id, 'data-bound': String(r.member.bound), 'data-live-session': String(r.member.liveSession) })}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'worker'}
              <PartyLabel party={row.member.worker} />
            {:else if cell.column.id === 'coordinator'}
              <span class="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1">
                {#if row.lane.coordinator}
                  <PartyLabel party={row.lane.coordinator} showUrn={false} />
                  {#if row.lane.coordinatorRetired}<span class="text-xs text-zinc-500 dark:text-zinc-400">{retired()}</span>{/if}
                {:else}
                  <span class="text-zinc-600 dark:text-zinc-300">{unassigned()}</span>
                {/if}
              </span>
            {:else if cell.column.id === 'state'}
              <span class={rosterStateChipClass(row.member.state)} data-roster-state={row.member.state}>{rosterStateLabel(row.member.state)}</span>
            {:else}
              <span class="block max-w-full truncate" title={String(cell.getValue() ?? '')}>{cell.getValue()}</span>
            {/if}
          {/snippet}
        </DataTable>
      </section>
    {/if}
  </div>
{/if}
