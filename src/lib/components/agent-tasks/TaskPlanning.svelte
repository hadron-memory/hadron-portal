<script lang="ts">
  import { taskChoiceStatus } from '$lib/agent-tasks/planning';
  import TaskHandle from './TaskHandle.svelte';
  import { onDestroy, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { AgentTaskDetail, TaskChoice, TaskDependencyPage, TaskRead } from '$lib/agent-tasks/types';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import type { TaskWarning } from '$lib/agent-tasks/warnings';
  import WriteRefusalAlert from './WriteRefusal.svelte';
  import TaskWarnings from './TaskWarnings.svelte';
  import SelectTask from './SelectTask.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  let { task, appId, canWrite, dependencies = { kind: 'failed' } }: { task: AgentTaskDetail; appId: string; canWrite: boolean; dependencies: TaskRead<{ blockedBy: TaskDependencyPage; blocks: TaskDependencyPage }> } = $props();
  let priority = $state(untrack(() => String(task.priority ?? '')));
  let picker = $state(false);
  let chosen = $state<TaskChoice | null>(null);
  let pending = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let warnings = $state<TaskWarning[]>([]);
  let more = $state(0);
  let saved = $state(false);
  let refreshFailed = $state(false);
  let taskKey = '';
  let generation = 0;
  $effect(() => {
    const id = `${appId}:${task.id}`;
    untrack(() => {
      if (id === taskKey) return;
      taskKey = id; generation++; pending = false; priority = String(task.priority ?? '');
      chosen = null; picker = false; refusal = null; warnings = []; more = 0; saved = false; refreshFailed = false;
    });
  });
  onDestroy(() => { generation++; relationGeneration++; });
  const canPriority = $derived(canWrite && task.handle !== 'AT0' && ['BACKLOG', 'PENDING', 'STARTED'].includes(task.status));
  const canBlockers = $derived(canWrite && task.handle !== 'AT0' && ['BACKLOG', 'PENDING'].includes(task.status));
  type Relation = TaskChoice & { direction: 'blockedBy' | 'blocks' };
  type Direction = 'blockedBy' | 'blocks';
  let relationView = $state(untrack(() => dependencies));
  let pagePending = $state({ blockedBy: false, blocks: false });
  let pageFailed = $state({ blockedBy: false, blocks: false });
  let relationFilter = $state('');
  let relationGeneration = 0;
  let relationScope = untrack(() => `${appId}:${task.id}`);
  let lastDependencies = untrack(() => dependencies);
  // Loader refreshes start a new relation snapshot. A page from before a write,
  // navigation or destruction must never append to that snapshot.
  $effect(() => {
    const source = dependencies;
    const scope = `${appId}:${task.id}`;
    untrack(() => {
      relationGeneration++;
      relationView = scope !== relationScope && source === lastDependencies ? { kind: 'failed' } : source;
      relationScope = scope; lastDependencies = source; relationFilter = '';
      pagePending = { blockedBy: false, blocks: false };
      pageFailed = { blockedBy: false, blocks: false };
    });
  });
  async function loadMore(direction: Direction) {
    if (pending || pagePending[direction] || relationView.kind !== 'ok' || !relationView.value[direction].hasMore) return;
    const current = relationGeneration;
    const targetApp = appId;
    const targetTask = task.id;
    const offset = relationView.value[direction].items.length;
    pagePending[direction] = true; pageFailed[direction] = false;
    try {
      const response = await fetch(`/app/apps/${encodeURIComponent(targetApp)}/tasks/${encodeURIComponent(targetTask)}/relations?direction=${direction}&offset=${offset}`);
      if (!response.ok) throw new Error('unavailable');
      const result: TaskRead<TaskDependencyPage> = await response.json();
      if (current !== relationGeneration) return;
      if (relationView.kind !== 'ok' || result.kind !== 'ok' || !Array.isArray(result.value.items) || typeof result.value.hasMore !== 'boolean' || result.value.items.length > 200 || result.value.items.some((row) => row.appId !== targetApp)) throw new Error('unavailable');
      const page = result.value;
      const seen = new Set(relationView.value[direction].items.map((row) => row.id));
      // Offset paging can shift under a concurrent edit. Keep the earlier view
      // and ask for a reload rather than silently presenting an incomplete union.
      if ((page.hasMore && page.items.length === 0) || page.items.some((row) => { if (seen.has(row.id)) return true; seen.add(row.id); return false; })) throw new Error('unavailable');
      relationView = { kind: 'ok', value: { ...relationView.value, [direction]: { items: [...relationView.value[direction].items, ...page.items], hasMore: page.hasMore } } };
    } catch { if (current === relationGeneration) pageFailed[direction] = true; }
    finally { if (current === relationGeneration) pagePending[direction] = false; }
  }
  const rows = $derived<Relation[]>(relationView.kind === 'ok' ? [
    ...relationView.value.blockedBy.items.map((item) => ({ ...item, direction: 'blockedBy' as const })),
    ...relationView.value.blocks.items.map((item) => ({ ...item, direction: 'blocks' as const })),
  ] : []);
  const columns: PortalColumnDef<Relation>[] = [
    { id: 'direction', accessorFn: (row) => row.direction === 'blockedBy' ? t('app.tasks.waits-for', 'Waits for') : t('app.tasks.holds-up', 'Holds up'), header: t('app.tasks.relation', 'Relation'), size: 120 },
    { accessorKey: 'title', header: t('app.tasks.col.task', 'Task'), size: 240 },
    { accessorKey: 'handle', header: t('app.tasks.col.handle', 'Handle'), size: 150 },
    { id: 'status', accessorFn: (row) => taskChoiceStatus(row.status), header: t('app.tasks.col.status', 'Status'), size: 120 },
    { id: 'remove', header: '', enableSorting: false, enableGlobalFilter: false, size: 90 },
  ];
  const table = createSvelteTable<Relation>({
    get data() { return rows; }, columns,
    state: { get globalFilter() { return relationFilter; } },
    onGlobalFilterChange: (u) => { relationFilter = typeof u === 'function' ? u(relationFilter) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
  const submit: Parameters<typeof enhance>[1] = ({ cancel }) => {
    if (pending) { cancel(); return; }
    const target = generation;
    relationGeneration++; pagePending = { blockedBy: false, blocks: false };
    pending = true; refusal = null; saved = false; refreshFailed = false; warnings = []; more = 0;
    return async ({ result, update }) => {
      if (target !== generation) return;
      if (result.type === 'success') {
        const data = result.data as { warnings?: TaskWarning[]; more?: number } | undefined;
        warnings = data?.warnings ?? []; more = data?.more ?? 0;
        saved = true; chosen = null;
        await invalidateAll().catch(() => { if (target === generation) refreshFailed = true; });
        if (target !== generation) return;
        priority = String(task.priority ?? '');
      } else if (result.type === 'failure') {
        refusal = (result.data as { refusal?: WriteRefusal }).refusal ?? { kind: 'uncertain' };
        // Retain every draft. The refreshed state may close a now-ineligible panel.
        if (refusal.kind === 'refused' && ['TASK_ENDED', 'TASK_INVALID_TRANSITION'].includes(refusal.code)) await invalidateAll().catch(() => { if (target === generation) refreshFailed = true; });
      } else { refusal = { kind: 'uncertain' }; }
      if (target !== generation) return;
      if (result.type === 'success' || result.type === 'failure') await update({ reset: false, invalidateAll: false });
      if (target === generation) pending = false;
    };
  };
</script>
<section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="task-planning">
  <h2 id="task-planning" class="font-semibold text-zinc-900 dark:text-white">{t('app.tasks.planning', 'Priority and blockers')}</h2>
  {#if canPriority}
    <form method="POST" action="?/priority" use:enhance={submit} class="flex flex-wrap items-end gap-2">
      <label for="task-priority" class="text-sm">{t('app.tasks.priority.edit-label', 'Priority (1 is highest)')}</label><select id="task-priority" name="priority" bind:value={priority} disabled={pending} class="ml-2 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600">{#each [1,2,3,4,5] as value}<option value={String(value)}>{value}</option>{/each}</select>
      <button disabled={pending || !priority} class="rounded border px-3 py-1 text-sm disabled:opacity-50">{t('app.tasks.priority.save', 'Save priority')}</button>
    </form>
  {:else}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.priority', 'Priority')}: {task.priority ?? '—'} <span class="text-xs">{t('app.tasks.priority.highest', '(1 is highest)')}</span></p>
  {/if}
  {#if relationView.kind !== 'ok'}
    <p role="status" class="text-sm">{t('app.tasks.dependencies.unknown', 'Blocker relations are unavailable. Reload to try again.')}</p>
  {:else}
    <DataTable {table} bind:globalFilter={relationFilter} listKey="task-dependencies" searchPlaceholder={t('app.tasks.dependencies.search', 'Filter loaded relations…')} searchAriaLabel={t('app.tasks.dependencies.search', 'Filter loaded relations…')} maxHeight="24rem">
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'title'}<a href="/app/apps/{appId}/tasks/{encodeURIComponent(row.id)}" class="text-indigo-700 underline dark:text-indigo-300">{row.title}</a>
        {:else if cell.column.id === 'remove'}
          {#if canBlockers && row.direction === 'blockedBy'}<form method="POST" action="?/removeBlocker" use:enhance={submit}><input type="hidden" name="blockerTaskRef" value={row.id} /><button disabled={pending} class="rounded border px-2 py-1 text-sm disabled:opacity-50">{t('app.tasks.blocker.remove', 'Remove')}</button></form>{/if}
        {:else if cell.column.id === 'handle'}<TaskHandle handle={row.handle} />
        {:else}{String(cell.getValue() ?? '')}{/if}
      {/snippet}
    </DataTable>
    <p class="text-xs text-zinc-600 dark:text-zinc-300">{t('app.tasks.dependencies.loaded-only', 'Search and table pages cover loaded relations only. Load more in each direction to see later relations.')}</p>
    <div class="flex flex-wrap gap-3">
      {#each ['blockedBy', 'blocks'] as direction}
        {@const key = direction as Direction}
        <div class="space-y-1">
          {#if relationView.value[key].hasMore}<button type="button" disabled={pending || pagePending[key]} onclick={() => loadMore(key)} class="rounded border px-3 py-1 text-sm disabled:opacity-50">{key === 'blockedBy' ? t('app.tasks.dependencies.more-waits', 'Load more Waits for') : t('app.tasks.dependencies.more-holds', 'Load more Holds up')}</button>{/if}
          {#if pagePending[key]}<p role="status" class="text-sm">{key === 'blockedBy' ? t('app.tasks.dependencies.loading-waits', 'Loading Waits for…') : t('app.tasks.dependencies.loading-holds', 'Loading Holds up…')}</p>{/if}
          {#if pageFailed[key]}<p role="alert" class="text-sm">{key === 'blockedBy' ? t('app.tasks.dependencies.failed-waits', 'Couldn’t load more Waits for. Try again.') : t('app.tasks.dependencies.failed-holds', 'Couldn’t load more Holds up. Try again.')} {t('app.tasks.dependencies.reload', 'Loaded rows are unchanged. Reload if the list changed.')}</p>{/if}
        </div>
      {/each}
    </div>
    {#if !rows.length}<p class="text-sm">{t('app.tasks.dependencies.empty', 'No blocker relations to show.')}</p>{/if}
  {/if}
  {#if canBlockers}
    <form method="POST" action="?/addBlocker" use:enhance={submit} class="space-y-2">
      <p class="text-sm">{t('app.tasks.waits-for', 'Waits for')}: {chosen?.title ?? t('app.tasks.blocker.none', 'No task selected')}</p>
      <input type="hidden" name="blockerTaskRef" value={chosen?.id ?? ''} />
      <div class="flex flex-wrap gap-2"><button type="button" disabled={pending} onclick={() => picker = true} class="rounded border px-3 py-1 text-sm">{t('app.tasks.choose', 'Choose a task')}</button><button disabled={pending || !chosen} class="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-50">{t('app.tasks.blocker.add', 'Add blocker')}</button></div>
    </form>
    <SelectTask {appId} bind:open={picker} onselect={(task) => chosen = task} />
  {/if}
  {#if canPriority || canBlockers}<p class="text-xs text-zinc-600 dark:text-zinc-300">{t('app.tasks.planning.authority', 'The server checks whether you may assign this task before saving priority or blockers.')}</p>{/if}
  {#if pending}<p role="status">{t('app.tasks.saving', 'Saving…')}</p>{/if}
  {#if saved}<p role="status">{refreshFailed ? t('app.tasks.saved-refresh-failed', 'Saved. Reload to refresh facts.') : t('app.tasks.saved', 'Saved. Facts refreshed.')}</p>{/if}
  {#if refreshFailed && !saved}<p role="status">{t('app.tasks.refresh-failed', 'Couldn’t refresh facts. Reload to check the current state.')}</p>{/if}
  {#if refusal}<WriteRefusalAlert {refusal} />{/if}
  <TaskWarnings {warnings} {more} />
</section>
