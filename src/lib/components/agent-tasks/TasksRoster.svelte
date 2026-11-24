<!--
  portal#1052 slice 2 — the Roster (design §6): what each worker is doing now,
  from `teamRoster`. One DataTable, sorted by attention by default. Task
  references are bare ids on the wire; they get titles from one open-task
  read, and an id outside it renders as "Task <short id>", still linked, never
  as "no task".
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import { partyName, partySearchText, URN_CHIP_COLUMN_PX } from '$lib/agent-tasks/status';
  import {
    rosterAttentionRank,
    rosterSessionLabel,
    rosterStateChipClass,
    rosterStateLabel,
    taskRefLabel,
    taskRefHandle,
    unavailableReasonLabel,
  } from '$lib/agent-tasks/roster';
  import type { TaskRead, TaskRefs, TeamRoster, TeamRosterEntry } from '$lib/agent-tasks/types';
  import TaskRef from './TaskRef.svelte';
  import NotParticipant from './NotParticipant.svelte';
  import PartyLabel from './PartyLabel.svelte';

  let {
    roster,
    refs,
    basePath,
    impersonating = null,
  }: { roster: TaskRead<TeamRoster>; refs: TaskRefs; basePath: string; impersonating?: string | null } = $props();

  /** The tasks a state's Detail cell names, so search reaches their titles and handles too. */
  function detailTasks(e: TeamRosterEntry): string[] {
    switch (e.state) {
      case 'ASSIGNED_NOT_STARTED':
        return e.pendingTasks;
      case 'WORKING':
        return e.startedTasks;
      case 'YOUR_MOVE':
        return e.unreactedChildTask ? [e.unreactedChildTask] : [];
      default:
        return [];
    }
  }

  /** The Detail cell's words (design §6), as text, for search and for the cell. */
  function detailText(e: TeamRosterEntry): string {
    switch (e.state) {
      case 'YOUR_MOVE':
        return [
          e.alarms.length ? t('app.tasks.roster.detail.alarms', '{n} unacknowledged alarm(s)', { n: e.alarms.length }) : '',
          e.unreactedChildTask
            ? t('app.tasks.roster.detail.unreacted', '{task} ended; not reacted to', { task: taskRefLabel(e.unreactedChildTask, refs) })
            : '',
        ].filter(Boolean).join(' · ');
      case 'UNAVAILABLE':
        return [
          unavailableReasonLabel(e.unavailableReason) ?? '',
          e.unavailableUntil ? t('app.tasks.roster.detail.until', 'until {time}', { time: fmtRunTime(e.unavailableUntil) }) : '',
          e.unavailableFamilies.length ? t('app.tasks.roster.detail.families', 'families: {f}', { f: e.unavailableFamilies.join(', ') }) : '',
        ].filter(Boolean).join(' · ');
      case 'WAITING':
        return t('app.tasks.roster.detail.waiting', 'on {n} subtask(s) since {time}', {
          n: e.waitingOn.length,
          time: e.waitingSince ? fmtRunTime(e.waitingSince) : '—',
        });
      case 'NO_FAMILY':
        return t('app.tasks.roster.detail.no-family', 'Its session reported no model family, so it can’t be matched');
      case 'NOT_LAUNCHABLE':
        return t('app.tasks.roster.detail.not-launchable', 'Unbound, and no live host can launch it');
      case 'AVAILABLE':
        return e.freeFamilies.length ? t('app.tasks.roster.detail.free-as', 'Free as {f}', { f: e.freeFamilies.join(', ') }) : '';
      default:
        return detailTasks(e).map((id) => taskRefLabel(id, refs)).join(', ');
    }
  }

  interface RosterRow {
    entry: TeamRosterEntry;
    worker: string;
    role: string;
    state: string;
    detail: string;
    family: string;
    session: string;
    lastActiveMs: number;
    reportsTo: string;
    freeAs: string;
    launchableAs: string;
    lastAssignedMs: number;
  }

  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '');

  const rows = $derived<RosterRow[]>(
    roster.kind === 'ok'
      ? roster.value.workers.map((entry) => ({
          entry,
          worker: partySearchText(entry.worker),
          role: entry.role ?? '',
          state: rosterStateLabel(entry.state),
          // Titles and handles both, like the Alarms and AI Team grid (Dorian's P3 on #1375).
          detail: [detailText(entry), ...detailTasks(entry).flatMap((id) => [taskRefLabel(id, refs), taskRefHandle(id, refs) ?? ''])].join(' ').trim(),
          family: entry.family ?? '',
          session: rosterSessionLabel(entry),
          lastActiveMs: ms(entry.lastActiveAt),
          reportsTo: partySearchText(entry.reportsTo),
          freeAs: entry.freeFamilies.join(', '),
          launchableAs: entry.launchableFamilies.join(', '),
          lastAssignedMs: ms(entry.lastAssignedAt),
        }))
      : [],
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<RosterRow>[] = [
    { id: 'worker', accessorFn: (r) => r.worker, header: t('app.tasks.roster.col.worker', 'Worker'), enableHiding: false, size: URN_CHIP_COLUMN_PX },
    { id: 'role', accessorFn: (r) => r.role, header: t('app.tasks.roster.col.role', 'Role'), size: 150 },
    {
      id: 'state',
      accessorFn: (r) => r.state,
      header: t('app.tasks.roster.col.state', 'State'),
      size: 190,
      // §6: by attention, ties by name. The rank isn't shown; the label is searchable.
      sortFn: (a, b) =>
        rosterAttentionRank(a.original.entry.state) - rosterAttentionRank(b.original.entry.state) ||
        partyName(a.original.entry.worker).localeCompare(partyName(b.original.entry.worker)),
    },
    { id: 'detail', accessorFn: (r) => r.detail, header: t('app.tasks.roster.col.detail', 'Detail'), enableSorting: false, size: 300 },
    { id: 'family', accessorFn: (r) => r.family, header: t('app.tasks.roster.col.family', 'Family'), size: 120 },
    { id: 'session', accessorFn: (r) => r.session, header: t('app.tasks.roster.col.session', 'Session'), size: 110 },
    { id: 'lastActive', accessorFn: (r) => r.lastActiveMs, header: t('app.tasks.roster.col.last-active', 'Last active'), size: 170 },
    { id: 'reportsTo', accessorFn: (r) => r.reportsTo, header: t('app.tasks.roster.col.reports-to', 'Reports to'), size: 200 },
    { id: 'freeAs', accessorFn: (r) => r.freeAs, header: t('app.tasks.roster.col.free-as', 'Free as'), size: 150 },
    { id: 'launchableAs', accessorFn: (r) => r.launchableAs, header: t('app.tasks.roster.col.launchable-as', 'Launchable as'), size: 150 },
    { id: 'lastAssigned', accessorFn: (r) => r.lastAssignedMs, header: t('app.tasks.roster.col.last-assigned', 'Last assigned'), size: 170 },
  ];
  const table = createSvelteTable<RosterRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<RosterRow>({ lastActive: fmtMs, lastAssigned: fmtMs }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'state', desc: false }],
      columnVisibility: { freeAs: false, launchableAs: false, lastAssigned: false },
    },
  });

  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }
</script>

{#if roster.kind === 'not-participant'}
  <NotParticipant {impersonating} />
{:else if roster.kind === 'failed'}
  <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
    {t('app.tasks.roster.failed', 'Couldn’t load the roster.')}
    <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tasks.retry', 'Try again')}</button>
  </div>
{:else}
  <div class="flex items-center justify-end gap-2 text-xs text-zinc-500 dark:text-zinc-400">
    <span>{t('app.tasks.roster.as-of', 'As of {time}', { time: fmtRunTime(roster.value.asOf) })}</span>
    <button
      type="button"
      onclick={refresh}
      disabled={refreshing}
      class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >{t('app.tasks.refresh', 'Refresh')}</button>
  </div>
  {#if rows.length === 0}
    <div class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
      {t('app.tasks.roster.empty', 'No workers on this App’s roster.')}
    </div>
  {/if}
  <DataTable
    {table}
    listKey="app-tasks:roster"
    searchPlaceholder={t('app.tasks.roster.search', 'Search the roster…')}
    searchAriaLabel={t('app.tasks.roster.search', 'Search the roster…')}
    bind:globalFilter
  >
    {#snippet cell(cell, row)}
      {@const e = row.entry}
      {#if cell.column.id === 'worker'}
        <PartyLabel party={e.worker} />
      {:else if cell.column.id === 'state'}
        <span class={rosterStateChipClass(e.state)} data-roster-state={e.state}>{rosterStateLabel(e.state)}</span>
      {:else if cell.column.id === 'detail'}
        <div class="min-w-0 text-sm">
          {#if e.state === 'YOUR_MOVE' && e.alarms.length}
            <!-- Uma's #2021 ruling: this link must land where every counted
                 alarm is visible. The count is the server's unacknowledged
                 total, which includes alarms whose escalation ended, so the
                 In-effect default can show fewer rows than the number beside
                 the link — All is the only existing view that contains them. -->
            <a href="{basePath}/tasks?view=alarms&alarms=all" class="text-indigo-600 hover:underline dark:text-indigo-300">
              {t('app.tasks.roster.detail.alarms', '{n} unacknowledged alarm(s)', { n: e.alarms.length })}
            </a>
          {/if}
          {#if detailTasks(e).length}
            <span class="flex flex-wrap gap-x-2">
              {#each detailTasks(e) as id (id)}
                <TaskRef {id} {refs} {basePath} />
              {/each}
              {#if e.state === 'YOUR_MOVE'}<span class="text-zinc-500">{t('app.tasks.roster.detail.ended-unreacted', 'ended; not reacted to')}</span>{/if}
            </span>
          {/if}
          {#if !['YOUR_MOVE', 'ASSIGNED_NOT_STARTED', 'WORKING'].includes(e.state)}
            <span class="text-zinc-600 dark:text-zinc-300">{detailText(e) || '—'}</span>
          {/if}
        </div>
      {:else if cell.column.id === 'lastActive'}
        <span>{e.lastActiveAt ? fmtRunTime(e.lastActiveAt) : '—'}</span>
      {:else if cell.column.id === 'lastAssigned'}
        <span>{e.lastAssignedAt ? fmtRunTime(e.lastAssignedAt) : '—'}</span>
      {:else if cell.column.id === 'reportsTo'}
        <span class="inline-flex flex-wrap items-center gap-1">
          <PartyLabel party={e.reportsTo} showUrn={false} />
          {#if e.reportsToRetired}<span class="text-xs text-zinc-500">{t('app.tasks.roster.retired', '(retired)')}</span>{/if}
        </span>
      {:else}
        <span class="block max-w-full truncate" title={String(cell.getValue() || '')}>{cell.getValue() || '—'}</span>
      {/if}
    {/snippet}
  </DataTable>
{/if}
