<script lang="ts">
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
  let priority = $state('');
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
    const id = task.id;
    untrack(() => {
      if (id === taskKey) return;
      taskKey = id; generation++; pending = false; priority = String(task.priority ?? '');
      chosen = null; picker = false; refusal = null; warnings = []; more = 0; saved = false; refreshFailed = false;
    });
  });
  onDestroy(() => { generation++; });
  const canPriority = $derived(canWrite && task.handle !== 'AT0' && ['BACKLOG', 'PENDING', 'STARTED'].includes(task.status));
  const canBlockers = $derived(canWrite && task.handle !== 'AT0' && ['BACKLOG', 'PENDING'].includes(task.status));
  type Relation = TaskChoice & { direction: 'blockedBy' | 'blocks' };
  const rows = $derived<Relation[]>(dependencies.kind === 'ok' ? [
    ...dependencies.value.blockedBy.items.map((item) => ({ ...item, direction: 'blockedBy' as const })),
    ...dependencies.value.blocks.items.map((item) => ({ ...item, direction: 'blocks' as const })),
  ] : []);
  const columns: PortalColumnDef<Relation>[] = [
    { id: 'direction', accessorFn: (row) => row.direction === 'blockedBy' ? t('app.tasks.waits-for', 'Waits for') : t('app.tasks.holds-up', 'Holds up'), header: t('app.tasks.relation', 'Relation'), size: 120 },
    { accessorKey: 'title', header: t('app.tasks.col.task', 'Task'), size: 240 },
    { accessorKey: 'handle', header: t('app.tasks.col.handle', 'Handle'), size: 150 },
    { accessorKey: 'status', header: t('app.tasks.col.status', 'Status'), size: 120 },
    { id: 'remove', header: '', enableSorting: false, enableGlobalFilter: false, size: 90 },
  ];
  const table = createSvelteTable<Relation>({ get data() { return rows; }, columns, initialState: { pagination: { pageIndex: 0, pageSize: 10 } } });
  const submit: Parameters<typeof enhance>[1] = ({ cancel }) => {
    if (pending) { cancel(); return; }
    const target = generation;
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
  <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.priority', 'Priority')}: {task.priority ?? '—'} <span class="text-xs">{t('app.tasks.priority.highest', '(1 is highest)')}</span></p>
  {#if canPriority}
    <form method="POST" action="?/priority" use:enhance={submit} class="flex flex-wrap items-end gap-2">
      <label for="task-priority" class="text-sm">{t('app.tasks.priority.change', 'Change priority')}</label><select id="task-priority" name="priority" bind:value={priority} disabled={pending} class="ml-2 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600">{#each [1,2,3,4,5] as value}<option value={String(value)}>{value}</option>{/each}</select>
      <button disabled={pending || !priority} class="rounded border px-3 py-1 text-sm disabled:opacity-50">{t('app.tasks.priority.save', 'Save priority')}</button>
    </form>
  {/if}
  {#if dependencies.kind !== 'ok'}
    <p role="status" class="text-sm">{t('app.tasks.dependencies.unknown', 'Blocker relations are unavailable. Reload to try again.')}</p>
  {:else}
    <DataTable {table} listKey="task-dependencies" searchPlaceholder={t('app.tasks.dependencies.search', 'Filter loaded relations…')} searchAriaLabel={t('app.tasks.dependencies.search', 'Filter loaded relations…')} maxHeight="24rem">
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'title'}<a href="/app/apps/{appId}/tasks/{encodeURIComponent(row.id)}" class="text-indigo-700 underline dark:text-indigo-300">{row.title}</a>
        {:else if cell.column.id === 'remove'}
          {#if canBlockers && row.direction === 'blockedBy'}<form method="POST" action="?/removeBlocker" use:enhance={submit}><input type="hidden" name="blockerTaskRef" value={row.id} /><button disabled={pending} class="rounded border px-2 py-1 text-sm disabled:opacity-50">{t('app.tasks.blocker.remove', 'Remove')}</button></form>{/if}
        {:else if cell.column.id === 'handle'}<TaskHandle handle={row.handle} />
        {:else}{String(cell.getValue() ?? '')}{/if}
      {/snippet}
    </DataTable>
    {#if dependencies.value.blockedBy.hasMore || dependencies.value.blocks.hasMore}<p class="text-sm">{t('app.tasks.dependencies.partial', 'Showing the first 200 relations in each direction. This is a partial list.')}</p>{/if}
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
