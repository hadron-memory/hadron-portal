<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { goto, afterNavigate } from '$app/navigation';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef, PortalTableState } from '$lib/table/features';
  import type { SavedView } from '$lib/table/savedView';
  import { t } from '$lib/i18n/t';
  import { RUN_STATUSES, describeTrigger, fmtRunTime, runDuration, failureCode, statusChipClass, type AppRun } from '$lib/flow/runs';
  import { runsHref, isRunsSection, RUNS_PAGE_SIZE, RUN_SORTS, type RunsSection, type RunsQuery } from '$lib/flow/app-runs-page';
  let { appRef, initial }: { appRef: string; initial: RunsSection } = $props();
  const mountedApp = untrack(() => appRef), mountedSection = untrack(() => initial);
  let snapshot = untrack(() => initial), resource = untrack(() => appRef);
  let section = $state(untrack(() => initial)), pending = $state(false), announcement = $state('');
  // Pending controls describe the newest request; rows still describe the served page.
  let intent = $state<RunsQuery | null>(null);
  const controls = $derived(intent ?? section);
  let heading: HTMLHeadingElement;
  let alive = true, epoch = 0;
  $effect(() => { if (initial !== snapshot || appRef !== resource) { epoch++; snapshot = initial; resource = appRef; section = initial; intent = null; announcement = ''; pending = false; } });
  onDestroy(() => { alive = false; epoch++; });
  afterNavigate(nav => {
    if (nav.type === 'enter') return;
    // Preserve a live filter control; recover only a lost BODY focus, still in this view.
    const generation = epoch;
    void tick().then(() => { if (alive && generation === epoch && document.activeElement === document.body) heading?.focus(); });
  });
  const sorting = $derived(section.sort === 'status' || section.sort === 'startedAt' ? [{ id: section.sort, desc: section.dir === 'desc' }] : []);
  const columns: PortalColumnDef<AppRun>[] = [
    { accessorKey: 'status', header: t('runs.col.status', 'Status'), size: 130 },
    { accessorKey: 'triggerKind', header: t('runs.col.trigger', 'Trigger'), enableSorting: false, size: 180 },
    { accessorKey: 'entryNodeUrn', header: t('runs.col.entry', 'Entry node'), enableSorting: false, size: 300, minSize: 220 },
    { accessorKey: 'startedAt', header: t('runs.col.started', 'Started'), size: 200 },
    { id: 'duration', header: t('runs.col.duration', 'Duration'), enableSorting: false, size: 110 },
    { id: 'failure', header: t('runs.col.failure', 'Failure'), enableSorting: false, size: 220 },
    { id: 'actions', header: t('runs.col.open', 'Open'), enableSorting: false, enableHiding: false, size: 140, minSize: 140 },
  ];
  // portal#2286: labels go through t() so they can be localized; a status with no key renders raw.
  const STATUS_LABELS: Record<string, string> = { PENDING: 'Pending', RUNNING: 'Running', COMPLETED: 'Completed', FAILED: 'Failed', TIMED_OUT: 'Timed out', CANCELLED: 'Cancelled' };
  const statusLabel = (status: string) => t(`runs.status.${status}`, Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : status);
  const SORT_LABELS: Record<RunsQuery['sort'], string> = { createdAt: 'Created', startedAt: 'Started', finishedAt: 'Finished', status: 'Status' };
  const sortSummary = $derived.by(() => {
    const sort = t(`runs.sort.${controls.sort}`, SORT_LABELS[controls.sort] ?? controls.sort);
    const order = controls.sort === 'status'
      ? (controls.dir === 'asc' ? t('runs.order.status-asc', 'A to Z') : t('runs.order.status-desc', 'Z to A'))
      : (controls.dir === 'asc' ? t('runs.order.time-asc', 'oldest first') : t('runs.order.time-desc', 'newest first'));
    return t('runs.sort-summary', 'Sorted by {sort}, {order}', { sort, order });
  });
  // The panel above explains an unfiltered-empty SERVED page once; when it is not showing that (the first read failed and Retry
  // recovered to empty), the table owns the one message, keyed on the same served `initial` the panel reads.
  const panelExplains = $derived(!initial.failed && initial.total === 0 && initial.statuses.length === 0);
  const ACTIVE = ['PENDING', 'RUNNING'];
  const allPressed = $derived(controls.statuses.length === 0);
  const activePressed = $derived(controls.statuses.length === ACTIVE.length && ACTIVE.every(x => controls.statuses.includes(x as never)));
  const pressedClass = (on: boolean) => on ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500' : 'border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  function query(change: Partial<RunsQuery>): RunsQuery { return { page: controls.page, statuses: controls.statuses, sort: controls.sort, dir: controls.dir, ...change }; }
  async function navigate(next: RunsQuery, replaceState = false) {
    const id = ++epoch, ref = appRef;
    intent = next; announcement = ''; pending = true;
    try { await goto(runsHref(ref, next), { replaceState, keepFocus: true, noScroll: true }); }
    catch { if (alive && id === epoch && ref === appRef) announcement = t('runs.navigation-failed', 'Could not open this runs page. Try again.'); }
    finally { if (alive && id === epoch && ref === appRef) { intent = null; pending = false; } }
  }
  const table = createSvelteTable<AppRun>({
    get data() { return section.runs; }, columns, defaultColumn: { minSize: 40 }, getRowId: r => r.id,
    manualPagination: true, manualSorting: true, manualFiltering: true,
    initialState: { sorting: [{ id: 'createdAt', desc: true }], pagination: { pageIndex: 0, pageSize: 20 } },
    get rowCount() { return section.total; }, enableMultiSort: false, enableSortingRemoval: false,
    get state() { return { sorting, columnFilters: section.statuses.length ? [{ id: 'status', value: section.statuses }] : [], pagination: { pageIndex: section.page - 1, pageSize: RUNS_PAGE_SIZE } }; },
    onSortingChange: updater => { const next = typeof updater === 'function' ? updater(sorting) : updater; const item = next[0]; void navigate(query({ page: 1, sort: RUN_SORTS.includes(item?.id as RunsQuery['sort']) ? item.id as RunsQuery['sort'] : 'createdAt', dir: item?.desc ? 'desc' : 'asc' })); },
    onPaginationChange: updater => { const now = { pageIndex: section.page - 1, pageSize: RUNS_PAGE_SIZE }; const next = typeof updater === 'function' ? updater(now) : updater; if (next.pageIndex !== now.pageIndex) void navigate(query({ page: next.pageIndex + 1 })); },
    meta: {
      getServerView: () => ({ sorting: [{ id: section.sort, desc: section.dir === 'desc' }], columnFilters: section.statuses.length ? [{ id: 'status', value: section.statuses }] : [] }),
      applyServerView: (view: SavedView, options?: { initial?: boolean }) => {
        if (options?.initial && (!alive || epoch !== 0 || appRef !== mountedApp || initial !== mountedSection)) return;
        const sort = view.sorting[0];
        const selected = view.columnFilters.find(x => x.id === 'status')?.value;
        const next = query({ page: 1, sort: RUN_SORTS.includes(sort?.id as RunsQuery['sort']) ? sort.id as RunsQuery['sort'] : 'createdAt', dir: sort ? (sort.desc ? 'desc' : 'asc') : 'desc', statuses: Array.isArray(selected) ? RUN_STATUSES.filter(x => selected.includes(x)) : [] });
        // Automatic restoration must not insert a synthetic Back stop or re-read identical data.
        if (options?.initial && runsHref(appRef, next) === runsHref(appRef, section)) return;
        void navigate(next, options?.initial === true);
      },
    },
  });
  async function retry() {
    const id = ++epoch, ref = appRef, basedOn = initial;
    const current = () => alive && id === epoch && ref === appRef && basedOn === initial;
    pending = true; announcement = '';
    try {
      const url = new URL(runsHref(ref, section), window.location.origin);
      const res = await fetch(`/app/apps/${encodeURIComponent(ref)}/runs-data${url.search}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('read failed');
      const value: unknown = await res.json();
      if (!isRunsSection(value)) throw new Error('invalid runs response');
      if (!current()) return;
      section = value;
      announcement = value.failed ? t('runs.read-failed', 'Could not load runs. Try again.') : t('runs.loaded', 'Runs loaded.');
      await tick(); if (current()) heading?.focus();
    } catch { if (current()) { announcement = t('runs.read-failed', 'Could not load runs. Try again.'); } }
    finally { if (current()) pending = false; }
  }
</script>
<div class="runs-grid min-w-0 space-y-4 text-zinc-900 dark:text-zinc-100" aria-busy={pending}>
  <h2 bind:this={heading} tabindex="-1" class="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500">{t('app.tabs.runs', 'Runs')}</h2>
  <p role="status" aria-live="polite" class="text-sm">{announcement}</p>
  <fieldset class="flex min-w-0 flex-wrap items-center gap-3">
    <legend class="sr-only">{t('runs.filter.statuses', 'Run statuses')}</legend>
    <label class="flex min-h-11 min-w-0 items-center gap-2">{t('runs.sort-by', 'Sort by')}
      <select aria-label={t('runs.sort-label', 'Sort runs by')} value={controls.sort} onchange={e => navigate(query({ page: 1, sort: e.currentTarget.value as RunsQuery['sort'] }))} class="min-h-11 min-w-0 rounded border border-zinc-300 bg-white px-2 text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
        <option value="createdAt">{t('runs.created', 'Created')}</option><option value="startedAt">{t('runs.started', 'Started')}</option><option value="finishedAt">{t('runs.finished', 'Finished')}</option><option value="status">{t('runs.status', 'Status')}</option>
      </select>
    </label>
    <label class="flex min-h-11 min-w-0 items-center gap-2">{t('runs.order', 'Order')}
      <select aria-label={t('runs.order-label', 'Run sort order')} value={controls.dir} onchange={e => navigate(query({ page: 1, dir: e.currentTarget.value as RunsQuery['dir'] }))} class="min-h-11 min-w-0 rounded border border-zinc-300 bg-white px-2 text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"><option value="desc">{t('runs.descending', 'Descending')}</option><option value="asc">{t('runs.ascending', 'Ascending')}</option></select>
    </label>
    <button type="button" aria-pressed={allPressed} onclick={() => navigate(query({ page: 1, statuses: [] }))} class="min-h-11 rounded border px-3 focus-visible:outline-2 focus-visible:outline-indigo-500 {pressedClass(allPressed)}">{t('runs.filter.all', 'All')}</button>
    <button type="button" aria-pressed={activePressed} onclick={() => navigate(query({ page: 1, statuses: ['PENDING', 'RUNNING'] }))} class="min-h-11 rounded border px-3 focus-visible:outline-2 focus-visible:outline-indigo-500 {pressedClass(activePressed)}">{t('runs.filter.active', 'Active')}</button>
    {#each RUN_STATUSES as status}<label class="flex min-h-11 items-center gap-1"><input type="checkbox" checked={controls.statuses.includes(status)} onchange={(e) => navigate(query({ page: 1, statuses: RUN_STATUSES.filter(s => s === status ? e.currentTarget.checked : controls.statuses.includes(s)) }))} />{statusLabel(status)}</label>{/each}
  </fieldset>
  <p data-testid="runs-sort-summary" class="text-sm text-zinc-600 dark:text-zinc-300">{sortSummary}</p>
  {#if section.failed}<div role="alert"><p>{t('runs.read-failed', 'Could not load runs. Try again.')}</p><button type="button" disabled={pending} onclick={retry} class="min-h-11 rounded border border-zinc-300 bg-white px-3 text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{t('runs.retry', 'Retry')}</button></div>
  {:else if section.total === 0 && section.statuses.length}<p>{t('runs.empty.filtered', 'No runs with this status yet.')}</p>
  {:else if section.total === 0 && !panelExplains}<p>{t('runs.empty.title', 'No runs yet.')}</p>{/if}
  <!-- portal#2286: the unfiltered empty case is explained once: by the panel above when the page was served empty, else by the line above. -->
  {#if !section.failed && !(section.total === 0 && !section.statuses.length && panelExplains)}<p>{t('runs.pager.total', 'Total:')} {section.total}</p>{/if}
  <DataTable containCells {table} listKey="app-runs-server" showSearch={false} showPageSize={false} initialColumnsOnly={section.explicitState} sortButtons={true} searchPlaceholder="" searchAriaLabel="">
    {#snippet cell(c, run)}
      {#if c.column.id === 'status'}<span class="inline-block max-w-full rounded px-2 py-1 [overflow-wrap:anywhere] {statusChipClass(run.status)}">{statusLabel(run.status)}</span>
      {:else if c.column.id === 'triggerKind'}{describeTrigger(run)}
      {:else if c.column.id === 'entryNodeUrn'}<Urn value={run.entryNodeUrn} type="node" size={11} compact />
      {:else if c.column.id === 'duration'}{runDuration(run)}
      {:else if c.column.id === 'failure'}{failureCode(run) ?? ''}
      {:else if c.column.id === 'actions'}<a href="/app/apps/{encodeURIComponent(appRef)}/runs/{run.id}" class="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center rounded text-indigo-700 underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">{t('runs.open', 'Open')}</a>
      {:else}{fmtRunTime(run[c.column.id as 'createdAt' | 'startedAt' | 'finishedAt'])}{/if}
    {/snippet}
  </DataTable>
</div>

<style>
  .runs-grid :global(td > .inline-flex) { flex-wrap: wrap; }
</style>
