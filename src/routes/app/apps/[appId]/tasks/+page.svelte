<script lang="ts">
  import { untrack } from 'svelte';
  import { TASK_SEARCH_MAX, taskBoardHref } from '$lib/agent-tasks/search';
  import { overdueApplies, type BoardNarrow } from '$lib/agent-tasks/narrow';
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
  import { goto } from '$app/navigation';
  import { parseHandle, taskHref } from '$lib/agent-tasks/handle';
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
    priority: number | undefined;
    ownerText: string;
    assigneeText: string;
    startByMs: number;
    updatedMs: number;
    createdMs: number;
    tagsText: string;
    id: string;
  }

  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;

  const rows = $derived<BoardRow[]>(
    board?.kind === 'ok'
      ? board.value.tasks.map((task) => {
          const state = taskDisplayState(task);
          return {
            task,
            priority: task.priority ?? undefined,
            statusText: [taskStateLabel(state, task.status), task.blocked === true ? t('app.tasks.blocked', 'Blocked') : '', task.waitingOnChildren && task.status === 'STARTED' ? waitingOnSubtasksLabel() : '']
              .filter(Boolean)
              .join(' '),
            title: [task.title, task.source ?? ''].join(' ').trim(),
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

  // portal#1349: the search box's live value, until the next server slice resets it.
  let typed = $state<string | null>(null);
  const searchValue = $derived(typed ?? data.text ?? '');
  // A whole handle once trimmed: a pasted "AT3.405 " is still one (Uma's P2).
  // portal#1415 item 3: the link NAMES the canonical spelling `parseHandle`
  // returns (upper case), never the case the user typed — and a bare handle
  // canonicalizes everywhere it travels (text, href, submit), so the URL bar
  // shows what the server recognizes. A qualified handle forwards its full
  // spelling in the href (the route answers a foreign App as unknown,
  // portal#1375 — the portal decides nothing) while the text still names its
  // bare handle.
  const typedHandle = $derived(parseHandle(searchValue.trim()));
  const exactHandleHref = $derived(
    typedHandle
      ? `${basePath}/tasks/${encodeURIComponent(typedHandle.appUrn === null ? typedHandle.handle : searchValue.trim())}`
      : '',
  );
  // Starts like a handle but is not a whole one ("AT3." or "AT3.4x"): the search
  // cannot match handles (#1401 searches titles and descriptions), so say so.
  const looksLikePartialHandle = (text: string) => /^AT\d/i.test(text) && !parseHandle(text);
  const columns: PortalColumnDef<BoardRow>[] = [
    { id: 'status', accessorFn: (r) => r.statusText, header: t('app.tasks.col.status', 'Status'), enableHiding: false, size: 170 },
    { id: 'title', accessorFn: (r) => r.title, header: t('app.tasks.col.task', 'Task'), enableHiding: false, size: 320 },
    { id: 'priority', accessorFn: (r) => r.priority, header: t('app.tasks.priority', 'Priority'), size: 110, sortDescFirst: false, sortFn: 'basic', sortUndefined: 'last' },
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
    // The server owns title/description search; even legacy saved filters must not hide its matches.
    manualFiltering: true,
    autoResetPageIndex: false,
    enableGlobalFilter: false,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'updated', desc: true }],
      columnVisibility: { created: false, tags: false, id: false },
    },
  });

  // portal#1427: Overdue and tags ride along every link; a page loaded without them reads as unset.
  const narrow: BoardNarrow = $derived({ overdue: data.overdue ?? false, tags: data.tags ?? [] });
  const narrowed = $derived(narrow.overdue || narrow.tags.length > 0);
  const overdueOffered = $derived(overdueApplies(data.filter));

  function viewHref(v: TaskView): string {
    return taskBoardHref(basePath, data.filter, data.text ?? '', v, narrow);
  }

  // Overdue can't match Ended or Backlog: the link still carries it so the next page says it was dropped.
  function filterHref(f: BoardFilter): string {
    return taskBoardHref(basePath, f, data.text ?? '', 'board', narrow);
  }

  // A route can be reused on navigation. Reset position for each server slice,
  // without subscribing to the table state that the reset itself writes.
  const boardSlice = $derived(JSON.stringify([data.app.id, data.filter, data.text ?? '', narrow.overdue, narrow.tags]));
  $effect(() => {
    void boardSlice;
    untrack(() => {
      table.resetPageIndex();
      typed = null;
    });
  });

  // Preserve a valid position on refresh, but never strand rows beyond a
  // shrunken last page. Only the derived bound triggers this write; the
  // current index read stays untracked so paging cannot subscribe itself.
  const lastPage = $derived(Math.max(0, Math.ceil(rows.length / table.atoms.pagination.get().pageSize) - 1));
  $effect(() => {
    const last = lastPage;
    untrack(() => {
      if (table.atoms.pagination.get().pageIndex > last) table.setPageIndex(last);
    });
  });

  function submitSearch(event: SubmitEvent) {
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('text') as HTMLInputElement;
    // portal#1349: an exact handle opens that task; the title search would never find it.
    input.value = input.value.trim();
    const parsed = parseHandle(input.value);
    if (parsed) {
      event.preventDefault();
      // portal#1415 item 3: a bare handle opens its canonical spelling, the
      // same destination the link offers; a qualified one forwards as-is.
      void goto(`${basePath}/tasks/${encodeURIComponent(parsed.appUrn === null ? parsed.handle : input.value)}`);
      return;
    }
    input.setCustomValidity(input.value.length > TASK_SEARCH_MAX
      ? t('app.tasks.search.bounds', 'Search text is 1 to 200 characters.') : '');
    if (!input.reportValidity()) { event.preventDefault(); return; }
    // Blank native GETs are canonicalized by the loader; keep the input usable
    // when a browser restores this document from its back/forward cache.
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
        data-sveltekit-reload
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
            data-sveltekit-reload
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

    <form method="GET" action="{basePath}/tasks" data-sveltekit-reload onsubmit={submitSearch} class="flex min-w-0 flex-wrap items-end gap-2" aria-label={t('app.tasks.search.form', 'Search tasks')}>
      <input type="hidden" name="status" value={data.filter} />
      <input type="hidden" name="view" value="board" />
      <div class="min-w-0 flex-1 basis-60">
        <label for="task-board-search" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.tasks.search.scope', 'Search title and description')}</label>
        <input id="task-board-search" name="text" type="search" value={data.text ?? ''}
          oninput={(event) => { event.currentTarget.setCustomValidity(''); typed = event.currentTarget.value; }}
          aria-describedby="task-search-guidance"
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
      </div>
      <div class="min-w-0 flex-1 basis-48">
        <label for="task-board-tags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.tasks.narrow.tags.label', 'Tagged with all of')}</label>
        <input id="task-board-tags" name="tags" type="text" value={narrow.tags.join(', ')}
          aria-describedby="task-tags-guidance"
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
      </div>
      <div class="pb-2">
        <label class="flex items-center gap-2 text-sm font-medium {overdueOffered ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-500'}">
          <input type="checkbox" name="overdue" value="1" checked={narrow.overdue} aria-disabled={overdueOffered ? undefined : 'true'}
            onclick={(event) => { if (!overdueOffered) event.preventDefault(); }}
            aria-describedby="task-overdue-guidance" class="size-4 rounded border-zinc-300 dark:border-zinc-700" />
          {t('app.tasks.narrow.overdue.label', 'Overdue only')}
        </label>
      </div>
      <button type="submit" class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('app.tasks.search.submit', 'Search')}</button>
      <a href={taskBoardHref(basePath, data.filter, '')} data-sveltekit-reload class="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">{t('app.tasks.search.clear', 'Clear')}</a>
      <p id="task-search-guidance" class="w-full text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.search.limit', 'Up to 200 characters after trimming. Searches titles and descriptions in this App.')}</p>
      <p id="task-tags-guidance" class="w-full text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.narrow.tags.guidance', 'Separate tags with commas. A task must have every tag listed.')}</p>
      <p id="task-overdue-guidance" class="w-full text-xs text-zinc-500 dark:text-zinc-400">
        {overdueOffered
          ? t('app.tasks.narrow.overdue.guidance', 'Overdue: the start-by time has passed and the task has not started.')
          : t('app.tasks.narrow.overdue.unavailable', 'Overdue applies to Active, Queued and All tasks.')}
      </p>
    </form>
    {#if data.overdueDropped}
      <p role="status" class="text-sm text-amber-700 dark:text-amber-300" data-testid="overdue-dropped">{t('app.tasks.narrow.overdue.dropped', 'Overdue was turned off: it does not apply to {bucket} tasks.', { bucket: boardFilterLabel(data.filter) })}</p>
    {/if}
    <!-- portal#1349: the search reads titles and descriptions, so an EXACT handle
         (the only way to name a subtask like AT3.405 here) is a real link to that
         task. The route hands the handle to the server's resolver; an unknown,
         malformed or foreign one answers there, exactly like an unknown id. -->
    {#if typedHandle}
      <!-- portal#1415 item 3: role=status makes the link's appearance and
           disappearance a POLITE announcement. No timer-driven text rides in
           here (review:ticking-content-outside-live-region): the content
           changes only on user keystrokes, and only when the text crosses
           into or out of being a whole handle. -->
      <p role="status" class="text-sm" data-testid="open-by-handle">
        <a href={exactHandleHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.tasks.open-handle', 'Open {handle}', { handle: typedHandle.handle })}</a>
      </p>
    {/if}

    {#if board.kind === 'invalid-search'}
      <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('app.tasks.search.bounds', 'Search text is 1 to 200 characters.')}</p>
    {:else if board.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tasks.load-failed', 'Couldn’t load tasks.')}
        <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tasks.retry', 'Try again')}</button>
      </div>
    {:else}
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tasks.search.shown', '{n} tasks shown', { n: rows.length })}</p>
      {#if board.value.capped}
        <div role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('app.tasks.search.capped', 'There may be more; narrow the search.')}
        </div>
      {/if}
      {#if rows.length === 0}
        <div role="status" class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-empty={data.filter}>
          {#if data.text && looksLikePartialHandle(data.text)}
            {t('app.tasks.search.partial-handle', 'No matching tasks. Handles open only when complete, for example AT3.405.')}
          {:else}
            {data.text ? t('app.tasks.search.empty', 'No matching tasks.') : narrowed ? t('app.tasks.narrow.empty', 'No tasks match these filters.') : boardEmptyText(data.filter)}
          {/if}
        </div>
      {/if}
      <DataTable
        {table}
        listKey="app-tasks:board"
        searchPlaceholder=""
        searchAriaLabel=""
        showSearch={false}
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
          {:else if cell.column.id === 'priority'}
            {row.priority ?? '—'}
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
