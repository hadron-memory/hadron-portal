<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import PartyLabel from '$lib/components/agent-tasks/PartyLabel.svelte';
  import TaskSource from '$lib/components/agent-tasks/TaskSource.svelte';
  import TaskStateChips from '$lib/components/agent-tasks/TaskStateChips.svelte';
  import TasksReadOnlyNote from '$lib/components/agent-tasks/TasksReadOnlyNote.svelte';
  import NotParticipant from '$lib/components/agent-tasks/NotParticipant.svelte';
  import TasksRoster from '$lib/components/agent-tasks/TasksRoster.svelte';
  import TasksComposition from '$lib/components/agent-tasks/TasksComposition.svelte';
  import TasksAlarms from '$lib/components/agent-tasks/TasksAlarms.svelte';
  import { TASK_VIEWS, taskViewLabel, type TaskView } from '$lib/agent-tasks/views';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import {
    BOARD_FILTERS,
    boardEmptyText,
    boardFilterLabel,
    partySearchText,
    taskDisplayState,
    taskStateLabel,
    waitingOnSubtasksLabel,
    type BoardFilter,
  } from '$lib/agent-tasks/status';
  import type { AgentTaskRow } from '$lib/agent-tasks/types';
  import { taskHref } from '$lib/agent-tasks/handle';
  import TaskHandle from '$lib/components/agent-tasks/TaskHandle.svelte';
  import type { PageData } from './$types';

  /**
   * portal#1052 — the App's task board (design §4): root tasks in one
   * DataTable, read-only. Rows are roots; a root's subtasks are on its detail
   * page (§4.1's fallback: the Subtasks cell links there, anchored at
   * #subtasks).
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const board = $derived(data.board);

  interface BoardRow {
    task: AgentTaskRow;
    /** Everything the Status cell shows, so search reaches the words, never the enum. */
    statusText: string;
    title: string;
    ownerText: string;
    assigneeText: string;
    startByMs: number;
    updatedMs: number;
    createdMs: number;
    tagsText: string;
    id: string;
  }

  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;
  /** A date column's rendered text from its epoch accessor; 0 is "no date". */
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '');

  const rows = $derived<BoardRow[]>(
    board?.kind === 'ok'
      ? board.value.tasks.map((task) => {
          const state = taskDisplayState(task);
          return {
            task,
            statusText: [taskStateLabel(state, task.status), task.waitingOnChildren && task.status === 'STARTED' ? waitingOnSubtasksLabel() : '']
              .filter(Boolean)
              .join(' '),
            title: [task.title, task.handle, task.source ?? ''].join(' ').trim(),
            ownerText: partySearchText(task.owner),
            assigneeText: partySearchText(task.assignee),
            startByMs: ms(task.startBy),
            updatedMs: ms(task.updatedAt ?? task.createdAt),
            createdMs: ms(task.createdAt),
            tagsText: task.tags.join(' '),
            id: task.id,
          };
        })
      : [],
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<BoardRow>[] = [
    { id: 'status', accessorFn: (r) => r.statusText, header: t('app.tasks.col.status', 'Status'), enableHiding: false, size: 170 },
    { id: 'title', accessorFn: (r) => r.title, header: t('app.tasks.col.task', 'Task'), enableHiding: false, size: 320 },
    { id: 'owner', accessorFn: (r) => r.ownerText, header: t('app.tasks.col.owner', 'Owner'), size: 200 },
    { id: 'assignee', accessorFn: (r) => r.assigneeText, header: t('app.tasks.col.assignee', 'Assignee'), size: 200 },
    { id: 'subtasks', accessorFn: () => '', header: t('app.tasks.col.subtasks', 'Subtasks'), enableSorting: false, enableGlobalFilter: false, size: 120 },
    { id: 'startBy', accessorFn: (r) => r.startByMs, header: t('app.tasks.col.start-by', 'Start by'), size: 170 },
    { id: 'updated', accessorFn: (r) => r.updatedMs, header: t('app.tasks.col.updated', 'Updated'), size: 170 },
    { id: 'created', accessorFn: (r) => r.createdMs, header: t('app.tasks.col.created', 'Created'), size: 170 },
    { id: 'tags', accessorFn: (r) => r.tagsText, header: t('app.tasks.col.tags', 'Tags'), size: 180 },
    { id: 'id', accessorFn: (r) => r.id, header: t('app.tasks.col.id', 'Id'), size: 260 },
  ];
  const table = createSvelteTable<BoardRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    // Dates sort by instant but search by what the cell shows (#820).
    globalFilterFn: makeGlobalFilterFn<BoardRow>({ startBy: fmtMs, updated: fmtMs, created: fmtMs }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'updated', desc: true }],
      columnVisibility: { created: false, tags: false, id: false },
    },
  });

  function viewHref(v: TaskView): string {
    return v === 'board' ? `${basePath}/tasks` : `${basePath}/tasks?view=${v}`;
  }

  function filterHref(f: BoardFilter): string {
    return f === 'active' ? `${basePath}/tasks` : `${basePath}/tasks?status=${f}`;
  }

  const overdue = (task: AgentTaskRow) =>
    task.status === 'PENDING' && task.startBy !== null && ms(task.startBy) > 0 && ms(task.startBy) < Date.now();

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

<svelte:head><title>{t('app.tasks.head', 'Tasks')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.tasks.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tasks.crumb.tasks', 'Tasks') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('app.tasks.title.prefix', 'Tasks:')}</span> {data.app.name}
    </h1>
    <TasksReadOnlyNote view={data.view ?? 'board'} />
  </div>

  <!-- §2: Board · Roster · Composition · Alarms, addressed by ?view=. Its own row scrolls on a phone, never the page. -->
  <nav aria-label={t('app.tasks.view.label', 'Task views')} class="-mx-1 flex overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
    {#each TASK_VIEWS as v (v)}
      <a
        href={viewHref(v)}
        aria-current={data.view === v ? 'page' : undefined}
        class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium {data.view === v
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}"
      >{taskViewLabel(v)}</a>
    {/each}
  </nav>

  {#if data.view === 'roster' && data.roster}
    <TasksRoster roster={data.roster} refs={data.refs} {basePath} impersonating={data.impersonating} />
  {:else if data.view === 'composition' && data.composition}
    <TasksComposition composition={data.composition} {basePath} impersonating={data.impersonating} />
  {:else if data.view === 'alarms' && data.alarms}
    <TasksAlarms alarms={data.alarms} filter={data.alarmFilter} limit={data.alarmsLimit} refs={data.refs} {basePath} impersonating={data.impersonating} />
  {:else if !board}
    <!-- The loader always reads the board for the board view; if it ever doesn't, say so rather than show nothing. -->
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('app.tasks.load-failed', 'Couldn’t load tasks.')}
    </div>
  {:else if board.kind === 'not-participant'}
    <NotParticipant impersonating={data.impersonating} />
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label={t('app.tasks.filter.label', 'Filter tasks by status')} class="flex flex-wrap items-center gap-1.5">
        {#each BOARD_FILTERS as f (f)}
          <a
            href={filterHref(f)}
            aria-current={data.filter === f ? 'page' : undefined}
            class="rounded-full px-2.5 py-1 text-xs font-medium {data.filter === f
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
          >{boardFilterLabel(f)}</a>
        {/each}
      </nav>
      <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{t('app.tasks.updated-at', 'Updated {time}', { time: fmtRunTime(data.loadedAt) })}</span>
        <button
          type="button"
          onclick={refresh}
          disabled={refreshing}
          class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('app.tasks.refresh', 'Refresh')}</button>
        <!-- portal#1090: the board's one write entry point. A support session writes nothing, so it gets none. -->
        {#if !data.impersonating}
          <a
            href="{basePath}/tasks/new"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >{t('app.tasks.write.new', 'New task')}</a>
        {/if}
      </div>
    </div>

    {#if board.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tasks.load-failed', 'Couldn’t load tasks.')}
        <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tasks.retry', 'Try again')}</button>
      </div>
    {:else}
      {#if board.value.capped}
        <div role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('app.tasks.capped', 'Showing the newest {n} tasks. There may be more; narrow the filter to see them.', { n: data.boardLimit })}
        </div>
      {/if}
      {#if rows.length === 0}
        <div role="status" class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-empty={data.filter}>
          {boardEmptyText(data.filter)}
        </div>
      {/if}
      <DataTable
        {table}
        listKey="app-tasks:board"
        searchPlaceholder={t('app.tasks.search', 'Search tasks…')}
        searchAriaLabel={t('app.tasks.search', 'Search tasks…')}
        bind:globalFilter
        maxHeight="max(240px, calc(100vh - 22rem))"
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'status'}
            <TaskStateChips task={row.task} />
          {:else if cell.column.id === 'title'}
            <div class="flex min-w-0 flex-col">
              <span class="flex min-w-0 items-center gap-1.5">
                <a href={taskHref(basePath, row.task)} class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.task.title}</a>
                <TaskHandle handle={row.task.handle} />
              </span>
              {#if row.task.source}<TaskSource source={row.task.source} />{/if}
            </div>
          {:else if cell.column.id === 'owner'}
            <PartyLabel party={row.task.owner} />
          {:else if cell.column.id === 'assignee'}
            {@const state = taskDisplayState(row.task)}
            {#if state === 'queued'}
              <span class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.assignee.nobody-yet', 'Nobody yet')}</span>
            {:else if state === 'backlog'}
              <PartyLabel party={null} emptyTitle={t('app.tasks.assignee.backlog-none', 'Backlog tasks have no assignee')} />
            {:else}
              <PartyLabel party={row.task.assignee} />
            {/if}
          {:else if cell.column.id === 'subtasks'}
            <a
              href="{taskHref(basePath, row.task)}#subtasks"
              aria-label={t('app.tasks.subtasks-of', 'Subtasks of {title}', { title: row.task.title })}
              class="text-sm text-indigo-600 hover:underline dark:text-indigo-300"
            >{t('app.tasks.subtasks.open', 'View subtasks')}</a>
          {:else if cell.column.id === 'startBy'}
            {#if row.task.startBy}
              <span class="whitespace-nowrap">{fmtRunTime(row.task.startBy)}</span>
              {#if overdue(row.task)}<span class="ml-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t('app.tasks.overdue', 'overdue')}</span>{/if}
            {:else}
              <span class="text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'updated'}
            <span class="whitespace-nowrap">{fmtRunTime(row.task.updatedAt ?? row.task.createdAt)}</span>
          {:else if cell.column.id === 'created'}
            <span class="whitespace-nowrap">{fmtRunTime(row.task.createdAt)}</span>
          {:else if cell.column.id === 'tags'}
            <span class="flex flex-wrap gap-1">
              {#each row.task.tags as tag (tag)}
                <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{tag}</span>
              {/each}
            </span>
          {:else if cell.column.id === 'id'}
            <code class="font-mono text-xs text-zinc-600 dark:text-zinc-300">{row.task.id}</code>
          {/if}
        {/snippet}
      </DataTable>
    {/if}
  {/if}
</div>
