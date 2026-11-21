<!--
  portal#1941 — explicit acknowledgement through the unchanged server gate.
  Native POST forms intentionally navigate: fresh loader data reflects the write,
  with no client-side replay and the same behavior without JavaScript.

  The server reads a newest-first page, continued by its oldest shown id.

  portal#2000 (A + D cue, Holger 2026-11-12): the default view is In effect,
  backed by the server's alarmsInEffect filter (#3934, hrn:node:hadronmemory.com:specs:cor:agt:050:20) —
  unacknowledged and with no recorded escalation end. The server applies it
  App-wide before cutting the page, so this view's empty state is an App-wide
  truth — on an unbounded read; a cursor-bounded page claims only its stretch
  (portal#2021, Atilla's BLIND P2) — and the client does not re-filter (it
  cannot re-derive
  escalationEndedAt from a row). Acknowledged and All stay page-local filters
  over the unfiltered read; when such a filter empties a page that has older
  pages behind it, the D cue says so with Next beside it. The unfiltered All
  view stays one click away (hrn:node:hadronmemory.com:specs:cor:agt:050:20 V77).
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import { START_FAILING_ALARM_TYPE, alarmRuleName } from '$lib/agent-tasks/events';
  import { partyName, partySearchText } from '$lib/agent-tasks/status';
  import {
    ALARM_FILTERS,
    alarmFilterLabel,
    alarmWakeSummary,
    filterAlarms,
    taskRefLabel,
    taskRefHandle,
    type AlarmFilter,
  } from '$lib/agent-tasks/roster';
  import type { AgentAlarm, TaskRead, TaskRefs } from '$lib/agent-tasks/types';
  import type { AlarmAckResult } from '$lib/agent-tasks/alarm-ack';
  import TaskWarnings from './TaskWarnings.svelte';
  import TaskRef from './TaskRef.svelte';
  import CopyCode from './CopyCode.svelte';
  import NotParticipant from './NotParticipant.svelte';
  import PartyLabel from './PartyLabel.svelte';

  let {
    alarms,
    filter,
    paging = null,
    refs,
    basePath,
    impersonating = null,
    ackResult = null,
  }: {
    alarms: TaskRead<{ alarms: AgentAlarm[]; nextBefore?: string | null }>;
    filter: AlarmFilter;
    paging?: { previousHref: string | null; nextHref: string | null } | null;
    refs: TaskRefs;
    basePath: string;
    impersonating?: string | null;
    ackResult?: AlarmAckResult | null;
  } = $props();

  const all = $derived(alarms.kind === 'ok' ? alarms.value.alarms : []);
  const shown = $derived(filterAlarms(all, filter));

  interface AlarmRow {
    alarm: AgentAlarm;
    raisedMs: number;
    rule: string;
    task: string;
    concerns: string;
    woke: string;
    status: string;
    chain: string;
  }

  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '');

  function wokeText(a: AgentAlarm): string {
    const { latestWoken, next } = alarmWakeSummary(a);
    return [
      latestWoken?.owner ? partyName(latestWoken.owner) : '',
      next?.owner ? t('app.tasks.alarms.next', 'next: {who} at {time}', { who: partyName(next.owner), time: fmtRunTime(next.dueAt) }) : '',
    ].filter(Boolean).join(' · ');
  }

  function statusText(a: AgentAlarm): string {
    return a.acknowledgedAt
      ? t('app.tasks.alarm.acknowledged', 'Acknowledged by {who}, {time}', {
          who: a.acknowledgedBy ? partyName(a.acknowledgedBy) : t('app.tasks.alarm.someone', 'someone'),
          time: fmtRunTime(a.acknowledgedAt),
        })
      : t('app.tasks.alarms.open-since', 'Open since {time}', { time: fmtRunTime(a.createdAt) });
  }

  const rows = $derived<AlarmRow[]>(
    shown.map((alarm) => ({
      alarm,
      raisedMs: ms(alarm.createdAt),
      rule: alarmRuleName(alarm.type),
      task: alarm.taskId ? [taskRefLabel(alarm.taskId, refs), taskRefHandle(alarm.taskId, refs) ?? ''].join(' ').trim() : '',
      concerns: partySearchText(alarm.subjectWorker),
      woke: wokeText(alarm),
      status: statusText(alarm),
      chain: alarmWakeSummary(alarm).wakes.map((w) => (w.owner ? partyName(w.owner) : '—')).join(' → '),
    })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<AlarmRow>[] = [
    { id: 'raised', accessorFn: (r) => r.raisedMs, header: t('app.tasks.alarms.col.raised', 'Raised'), size: 200 },
    { id: 'rule', accessorFn: (r) => r.rule, header: t('app.tasks.alarms.col.rule', 'Rule'), enableHiding: false, size: 170 },
    { id: 'task', accessorFn: (r) => r.task, header: t('app.tasks.alarms.col.task', 'Task'), size: 260, minSize: 160 },
    { id: 'status', accessorFn: (r) => r.status, header: t('app.tasks.alarms.col.status', 'Status'), enableHiding: false, size: 300, minSize: 130 },
    { id: 'concerns', accessorFn: (r) => r.concerns, header: t('app.tasks.alarms.col.concerns', 'Concerns'), size: 200, minSize: 120 },
    { id: 'woke', accessorFn: (r) => r.woke, header: t('app.tasks.alarms.col.woke', 'Woke'), enableSorting: false, size: 240 },
    { id: 'chain', accessorFn: (r) => r.chain, header: t('app.tasks.alarms.col.chain', 'Chain'), enableSorting: false, size: 260 },
  ];
  const table = createSvelteTable<AlarmRow>({
    get data() { return rows; },
    columns,
    defaultColumn: { minSize: 40 },
    manualPagination: true,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<AlarmRow>({ raised: fmtMs }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'raised', desc: true }],
      columnVisibility: { chain: false },
    },
  });

  function filterHref(f: AlarmFilter): string {
    return f === 'in-effect' ? `${basePath}/tasks?view=alarms` : `${basePath}/tasks?view=alarms&alarms=${f}`;
  }

  function acknowledgeHref(): string {
    let href = filterHref(filter);
    // A write reloads the same history slice; filter links still start at newest.
    for (const key of ['alarmBefore', 'alarmAfter']) {
      const cursor = $page.url.searchParams.get(key);
      if (cursor) href += `&${key}=${encodeURIComponent(cursor)}`;
    }
    return `${href}&/acknowledgeAlarm`;
  }

  // portal#2000: In effect is server-filtered App-wide before paging, so an
  // empty page there means none in effect at all — not a page-local claim.
  // Acknowledged and All remain page-local; the D cue below carries the
  // "older pages may hold matches" half for the one that can lie.
  // portal#2021 (Atilla's BLIND P2): that App-wide truth holds only for an
  // unbounded read. A cursor in the URL bounds it — the acknowledgement flow
  // reloads the same URL, and the acknowledged alarm may have been the only
  // one in range — so an empty page under a cursor claims only its stretch.
  const cursorBounded = $derived(['alarmBefore', 'alarmAfter'].some((k) => $page.url.searchParams.get(k)));
  const emptyText = $derived(
    filter === 'in-effect'
      ? cursorBounded
        ? t('app.tasks.alarms.empty.in-effect.page', 'No alarms in effect on this page.')
        : t('app.tasks.alarms.empty.in-effect', 'No alarms in effect.')
      : filter === 'acknowledged'
        ? t('app.tasks.alarms.empty.acknowledged', 'No acknowledged alarms on this page.')
        : t('app.tasks.alarms.empty.none', 'No alarms on this page.'),
  );

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

<!-- Result stays outside the filtered row, including when an acknowledged row disappears. -->
<div role="status" aria-live="polite" data-alarm-ack-status class="text-sm text-zinc-700 dark:text-zinc-300">
  {#if ackResult?.kind === 'acknowledged'}
    {t('app.tasks.alarm.ack-success', 'Alarm acknowledged.')}
  {:else if ackResult?.kind === 'already-acknowledged'}
    {t('app.tasks.alarm.ack-already', 'This alarm is already acknowledged; the first acknowledgement stands.')}
  {/if}
</div>
<div role="alert" data-alarm-ack-error class="text-sm text-red-800 dark:text-red-300">
  {#if ackResult?.kind === 'refused'}
    <p>{t('app.tasks.alarm.ack-refused', 'Not changed.')}</p>
    {#if ackResult.message}<p>{ackResult.message}</p>{/if}
    {#if ackResult.code}<code class="select-all">{ackResult.code}</code>{/if}
  {:else if ackResult?.kind === 'uncertain'}
    <p>{t('app.tasks.alarm.ack-uncertain', 'The acknowledgement may or may not have gone through. Refresh to check before trying again.')}</p>
    <a href={filterHref(filter)} data-sveltekit-reload class="underline">{t('app.tasks.alarms.reload', 'Refresh alarms')}</a>
  {/if}
</div>
<TaskWarnings warnings={ackResult?.warnings ?? []} more={ackResult?.more ?? 0} />

{#if alarms.kind === 'not-participant'}
  <NotParticipant {impersonating} />
{:else if alarms.kind === 'failed'}
  <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
    {t('app.tasks.alarms.failed', 'Couldn’t load alarms.')}
    <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tasks.retry', 'Try again')}</button>
  </div>
{:else}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <nav aria-label={t('app.tasks.alarms.filter.label', 'Filter alarms')} class="flex flex-wrap items-center gap-1.5">
      {#each ALARM_FILTERS as f (f)}
        <a
          href={filterHref(f)}
          aria-current={filter === f ? 'page' : undefined}
          class="rounded-full px-2.5 py-1 text-xs font-medium {filter === f
            ? 'bg-indigo-600 text-white'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
        >{alarmFilterLabel(f)}</a>
      {/each}
    </nav>
    <button
      type="button"
      onclick={refresh}
      disabled={refreshing}
      class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >{t('app.tasks.refresh', 'Refresh')}</button>
  </div>
  <LiveRegion data-testid="alarms-empty-region">
  {#if rows.length === 0}
    <div class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-empty-alarms={filter}>
      <p>
        {emptyText}
        <!-- Uma on #2021: an App-wide empty In effect still owes the reader a
             way forward — out-of-effect alarms stay one click away (V77). -->
        {#if filter === 'in-effect' && !cursorBounded}
          <a href={filterHref('all')} class="inline-flex min-h-11 items-center font-medium text-indigo-600 underline dark:text-indigo-400">{t('app.tasks.alarms.empty.show-all', 'Show all alarms.')}</a>
        {/if}
      </p>
      <!-- portal#2000 D: a page-local filter that empties this page says so
           when older pages exist behind it — Next is right here, not only in
           the paging nav below. Server-side in-effect never needs it: its
           empty page is the end of the read, not a page that filtered out.
           portal#2021 (Atilla's BLIND P2): a CURSOR-bounded in-effect read is
           the exception — newer in-effect alarms may sit above the cursor, so
           Newest is right here too, not only in the paging nav below. -->
      {#if filter === 'in-effect' && cursorBounded}
        <p class="mt-1">
          {t('app.tasks.alarms.empty.newer-in-effect', 'Newer pages may hold alarms in effect.')}
          <a href={filterHref('in-effect')} class="inline-flex min-h-11 items-center font-medium text-indigo-600 underline dark:text-indigo-400">{t('app.tasks.alarms.newest', 'Newest')}</a>
        </p>
      {:else if filter === 'acknowledged' && paging?.nextHref}
        <p class="mt-1">
          {t('app.tasks.alarms.empty.older-pages', 'Older pages may hold acknowledged alarms.')}
          <a href={paging.nextHref} class="inline-flex min-h-11 items-center font-medium text-indigo-600 underline dark:text-indigo-400">{t('app.tasks.alarms.next-page', 'Next')}</a>
        </p>
      {/if}
    </div>
  {/if}
  </LiveRegion>
  <p class="text-xs text-zinc-500 dark:text-zinc-400">{filter === 'in-effect'
    ? t('app.tasks.alarms.scope.in-effect', 'The In effect filter spans all of the App’s alarms; search and sorting apply to this page.')
    : t('app.tasks.alarms.page-scope', 'Filters, search and sorting apply to this page.')}</p>
  <div class="alarms-grid min-w-0">
  <DataTable
    containCells
    showFooter={false}
    {table}
    listKey="app-tasks:alarms"
    searchPlaceholder={t('app.tasks.alarms.search', 'Search this page…')}
    searchAriaLabel={t('app.tasks.alarms.search', 'Search this page…')}
    bind:globalFilter
  >
    {#snippet cell(cell, row)}
      {@const a = row.alarm}
      {#if cell.column.id === 'raised'}
        <span class="[overflow-wrap:anywhere]">{fmtRunTime(a.createdAt)}</span>
      {:else if cell.column.id === 'rule'}
        <span class="font-medium text-red-700 dark:text-red-300">{row.rule}</span>
      {:else if cell.column.id === 'task'}
        {#if a.taskId}
          <TaskRef id={a.taskId} {refs} {basePath} />
        {:else}
          <span class="text-zinc-400">—</span>
        {/if}
      {:else if cell.column.id === 'concerns'}
        <PartyLabel party={a.subjectWorker} showUrn={a.type === START_FAILING_ALARM_TYPE} />
      {:else if cell.column.id === 'status'}
        {#if a.acknowledgedAt}
          <span class="text-zinc-700 dark:text-zinc-300">{row.status}</span>
        {:else}
          <div class="flex flex-col gap-1">
            <span class="font-medium text-amber-700 dark:text-amber-300">{row.status}</span>
            {#if !impersonating}
              <form method="POST" action={acknowledgeHref()}>
                <input type="hidden" name="eventId" value={a.id} />
                <button type="submit" disabled={ackResult?.kind === 'uncertain' && ackResult.eventId === a.id}
                  class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >{t('app.tasks.alarm.ack', 'Acknowledge')}</button>
              </form>
            {/if}
            <CopyCode value="hadron team alarm ack {a.id}" label={t('app.tasks.alarm.copy-ack', 'Copy the command that acknowledges this alarm')} />
          </div>
        {/if}
      {:else}
        <span class="block max-w-full [overflow-wrap:anywhere]">{cell.getValue() || '—'}</span>
      {/if}
    {/snippet}
  </DataTable>
  </div>
  {#if paging}
    <nav aria-label={t('app.tasks.alarms.pages', 'Alarm pages')} class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <a href={filterHref(filter)} class="inline-flex min-h-11 items-center text-indigo-600 dark:text-indigo-400">{t('app.tasks.alarms.newest', 'Newest')}</a>
      <div class="flex flex-wrap gap-2">
        {#if paging.previousHref}<a href={paging.previousHref} class="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.tasks.alarms.previous', 'Previous')}</a>{/if}
        {#if paging.nextHref}<a href={paging.nextHref} class="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.tasks.alarms.next-page', 'Next')}</a>{/if}
      </div>
    </nav>
  {/if}
{/if}

<style>
  /* Cell-local adaptation; TaskRef/PartyLabel/CopyCode elsewhere stay unchanged. */
  .alarms-grid :global(td .inline-flex) { flex-wrap: wrap; }
  .alarms-grid :global(td [data-task-handle]) { position: relative; min-width: 0; max-width: 100%; flex-shrink: 1; }
  .alarms-grid :global(td a) { max-width: 100%; min-width: 44px; white-space: normal; overflow-wrap: anywhere; }
  .alarms-grid :global(td button), .alarms-grid :global(td a) {
    display: inline-flex; align-items: center; min-height: 44px;
  }
  .alarms-grid :global(td button) { min-width: 44px; }
  .alarms-grid :global(td button:focus-visible), .alarms-grid :global(td a:focus-visible) {
    outline: 2px solid var(--color-indigo-500); outline-offset: 2px;
  }
</style>
