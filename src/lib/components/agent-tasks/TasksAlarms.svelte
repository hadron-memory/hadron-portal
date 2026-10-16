<!--
  portal#1052 slice 2 — the Alarms list (design §7), variant A: read-only
  (Holger #11535). No Acknowledge button. An open alarm shows the CLI line
  that acknowledges it, so a reader who may acknowledge knows where to.

  The server reads alarms oldest-first only, so the loader walks the stream
  and the list sorts newest first here. Open / Acknowledged / All filter on
  `acknowledgedAt` in the page: the server has no unacknowledged filter yet
  (design §9 asks 1 and 2).
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import { alarmRuleName } from '$lib/agent-tasks/events';
  import { partyName, partySearchText } from '$lib/agent-tasks/status';
  import {
    ALARM_FILTERS,
    alarmFilterLabel,
    alarmWakeSummary,
    filterAlarms,
    taskRefLabel,
    type AlarmFilter,
  } from '$lib/agent-tasks/roster';
  import type { AgentAlarm, TaskRead } from '$lib/agent-tasks/types';
  import CopyCode from './CopyCode.svelte';
  import NotParticipant from './NotParticipant.svelte';
  import PartyLabel from './PartyLabel.svelte';

  let {
    alarms,
    filter,
    limit,
    titles,
    basePath,
    impersonating = null,
  }: {
    alarms: TaskRead<{ alarms: AgentAlarm[]; capped: boolean }>;
    filter: AlarmFilter;
    limit: number;
    titles: Record<string, string>;
    basePath: string;
    impersonating?: string | null;
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
      task: alarm.taskId ? taskRefLabel(alarm.taskId, titles) : '',
      concerns: partySearchText(alarm.subjectWorker),
      woke: wokeText(alarm),
      status: statusText(alarm),
      chain: alarmWakeSummary(alarm).wakes.map((w) => (w.owner ? partyName(w.owner) : '—')).join(' → '),
    })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<AlarmRow>[] = [
    { id: 'raised', accessorFn: (r) => r.raisedMs, header: t('app.tasks.alarms.col.raised', 'Raised'), size: 170 },
    { id: 'rule', accessorFn: (r) => r.rule, header: t('app.tasks.alarms.col.rule', 'Rule'), enableHiding: false, size: 170 },
    { id: 'task', accessorFn: (r) => r.task, header: t('app.tasks.alarms.col.task', 'Task'), size: 260 },
    { id: 'concerns', accessorFn: (r) => r.concerns, header: t('app.tasks.alarms.col.concerns', 'Concerns'), size: 200 },
    { id: 'woke', accessorFn: (r) => r.woke, header: t('app.tasks.alarms.col.woke', 'Woke'), enableSorting: false, size: 240 },
    { id: 'status', accessorFn: (r) => r.status, header: t('app.tasks.alarms.col.status', 'Status'), enableHiding: false, size: 300 },
    { id: 'chain', accessorFn: (r) => r.chain, header: t('app.tasks.alarms.col.chain', 'Chain'), enableSorting: false, size: 260 },
  ];
  const table = createSvelteTable<AlarmRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<AlarmRow>({ raised: fmtMs }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 25 },
      sorting: [{ id: 'raised', desc: true }],
      columnVisibility: { chain: false },
    },
  });

  function filterHref(f: AlarmFilter): string {
    return f === 'open' ? `${basePath}/tasks?view=alarms` : `${basePath}/tasks?view=alarms&alarms=${f}`;
  }

  const emptyText = $derived(
    filter === 'open'
      ? all.length === 0
        ? t('app.tasks.alarms.empty.none', 'No alarms have been raised in this App.')
        : t('app.tasks.alarms.empty.open', 'No open alarms.')
      : filter === 'acknowledged'
        ? t('app.tasks.alarms.empty.acknowledged', 'No acknowledged alarms.')
        : t('app.tasks.alarms.empty.none', 'No alarms have been raised in this App.'),
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
  {#if alarms.value.capped}
    <div role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('app.tasks.alarms.capped', 'Showing the first {n} alarms in this App’s history; newer ones may be missing. (The server can only read alarms oldest-first today.)', { n: limit })}
    </div>
  {/if}
  {#if rows.length === 0}
    <div role="status" class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-empty-alarms={filter}>
      {emptyText}
    </div>
  {/if}
  <DataTable
    {table}
    listKey="app-tasks:alarms"
    searchPlaceholder={t('app.tasks.alarms.search', 'Search alarms…')}
    searchAriaLabel={t('app.tasks.alarms.search', 'Search alarms…')}
    bind:globalFilter
    maxHeight="max(240px, calc(100vh - 26rem))"
  >
    {#snippet cell(cell, row)}
      {@const a = row.alarm}
      {#if cell.column.id === 'raised'}
        <span class="whitespace-nowrap">{fmtRunTime(a.createdAt)}</span>
      {:else if cell.column.id === 'rule'}
        <span class="font-medium text-red-700 dark:text-red-300">{row.rule}</span>
      {:else if cell.column.id === 'task'}
        {#if a.taskId}
          <a href="{basePath}/tasks/{a.taskId}" class="truncate text-indigo-600 hover:underline dark:text-indigo-300">{row.task}</a>
        {:else}
          <span class="text-zinc-400">—</span>
        {/if}
      {:else if cell.column.id === 'concerns'}
        <PartyLabel party={a.subjectWorker} showUrn={false} />
      {:else if cell.column.id === 'status'}
        {#if a.acknowledgedAt}
          <span class="text-zinc-700 dark:text-zinc-300">{row.status}</span>
        {:else}
          <span class="flex flex-col gap-1">
            <span class="font-medium text-amber-700 dark:text-amber-300">{row.status}</span>
            <CopyCode value="hadron team alarm ack {a.id}" label={t('app.tasks.alarm.copy-ack', 'Copy the command that acknowledges this alarm')} />
          </span>
        {/if}
      {:else}
        <span class="truncate">{cell.getValue() || '—'}</span>
      {/if}
    {/snippet}
  </DataTable>
{/if}
