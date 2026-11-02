<script lang="ts">
  import { taskChoiceStatus } from '$lib/agent-tasks/planning';
  import TaskHandle from './TaskHandle.svelte';
  import { untrack } from 'svelte';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import type { TaskChoice, TaskRead } from '$lib/agent-tasks/types';
  // portal#1575: `includeEnded` lists finished and cancelled tasks too (the reference picker only); every
  // other caller keeps the open-tasks default.
  let { appId, open = $bindable(false), onselect, includeEnded = false }: { appId: string; open?: boolean; onselect: (task: TaskChoice) => void; includeEnded?: boolean } = $props();
  let items = $state<TaskChoice[]>([]);
  let offset = $state(0);
  let hasMore = $state(true);
  let pending = $state(false);
  let failed = $state(false);
  let repeated = $state(false);
  let query = $state('');
  let exact = $state('');
  let exactItems = $state<TaskChoice[]>([]);
  let exactDone = $state(false);
  let generation = 0;
  const columns: PortalColumnDef<TaskChoice>[] = [
    { accessorKey: 'title', header: t('app.tasks.col.task', 'Task'), enableHiding: false, size: 240 },
    { accessorKey: 'handle', header: t('app.tasks.col.handle', 'Handle'), size: 150 },
    { id: 'status', accessorFn: (row) => taskChoiceStatus(row.status), header: t('app.tasks.col.status', 'Status'), size: 120 },
    { id: 'choose', header: '', enableSorting: false, enableGlobalFilter: false, size: 90 },
  ];
  const shown = $derived(exactDone ? exactItems : items);
  const table = createSvelteTable<TaskChoice>({
    get data() { return shown; }, columns,
    state: { get globalFilter() { return query; } },
    onGlobalFilterChange: (u) => { query = typeof u === 'function' ? u(query) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
  async function read(exactRef?: string) {
    if (pending) return;
    const current = generation;
    const targetApp = appId;
    pending = true; failed = false;
    if (exactRef) { exactDone = true; exactItems = []; }
    try {
      const params = (exactRef ? `exact=${encodeURIComponent(exactRef)}` : `offset=${offset}`) + (includeEnded ? '&ended=1' : '');
      const response = await fetch(`/app/apps/${encodeURIComponent(targetApp)}/tasks/choices?${params}`);
      if (!response.ok) throw new Error('unavailable');
      const result: TaskRead<{ items: TaskChoice[]; hasMore: boolean }> = await response.json();
      if (current !== generation) return;
      if (result.kind !== 'ok' || !Array.isArray(result.value.items) || result.value.items.some((task) => task.appId !== targetApp)) throw new Error('unavailable');
      if (exactRef) { exactItems = result.value.items; exactDone = true; }
      else {
        const seen = new Set(items.map((task) => task.id));
        const fresh = result.value.items.filter((task) => {
          if (seen.has(task.id)) return false;
          seen.add(task.id); return true;
        });
        repeated = fresh.length !== result.value.items.length;
        items = [...items, ...fresh];
        offset += result.value.items.length;
        hasMore = result.value.hasMore && fresh.length > 0;
      }
    } catch { if (current === generation) failed = true; }
    finally { if (current === generation) pending = false; }
  }
  $effect(() => {
    const key = appId;
    const visible = open;
    untrack(() => {
      generation++;
      items = []; exactItems = []; offset = 0; hasMore = true; pending = false;
      failed = false; repeated = false; query = ''; exact = ''; exactDone = false;
      if (visible && key) void read();
    });
    return () => { generation++; };
  });

  // Escape: consumed at this dialog's own layer — the shared helper owns the
  // layering contract and the guards (src/lib/a11y/dialog-escape.ts).
  const escapeFallback = { close: () => { open = false; } };
</script>
{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[8vh]">
    <div role="dialog" aria-modal="true" aria-label={t('app.tasks.choose', 'Choose a task')} tabindex="-1" use:focusTrap use:dialogEscapeFallback={escapeFallback} onkeydown={(event) => consumeEscapeAtDialog(event, escapeFallback)} class="max-h-[84vh] w-full max-w-3xl space-y-3 overflow-auto rounded-xl border border-zinc-300 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      <div class="flex justify-between gap-3"><h2 class="font-semibold">{t('app.tasks.choose', 'Choose a task')}</h2><button type="button" onclick={() => open = false}>{t('app.tasks.close', 'Close')}</button></div>
      <p class="text-xs text-zinc-600 dark:text-zinc-300">{t('app.tasks.picker.loaded-only', 'Search filters loaded pages only. Load more tasks, or look up an exact handle or id.')}</p>
      <div class="flex flex-wrap gap-2">
        <label class="min-w-0 grow text-sm">{t('app.tasks.picker.exact', 'Exact handle or id')}<input bind:value={exact} class="block w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600" /></label>
        <button type="button" disabled={pending || !exact.trim()} onclick={() => read(exact.trim())} class="self-end rounded border px-3 py-1 disabled:opacity-50">{t('app.tasks.picker.lookup', 'Look up')}</button>
        {#if exactDone}<button type="button" onclick={() => { exactDone = false; exactItems = []; }}>{t('app.tasks.picker.browse', 'Browse loaded tasks')}</button>{/if}
      </div>
      {#if failed}<p role="alert">{t('app.tasks.picker.failed', 'Couldn’t load tasks. Try again.')}</p><button type="button" disabled={pending} onclick={() => read(exact.trim() || undefined)}>{t('app.tasks.retry', 'Try again')}</button>{/if}
      {#if repeated}<p role="status">{t('app.tasks.picker.changed', 'The list changed while loading. Some tasks may be missing; close and reopen to refresh, or use an exact lookup.')}</p>{/if}
      {#if pending}<p role="status">{t('app.tasks.picker.loading', 'Loading tasks…')}</p>{/if}
      {#if exactDone && !pending && !failed && exactItems.length === 0}<p role="status">{t('app.tasks.picker.unavailable', 'No available task found in this App.')}</p>{/if}
      <DataTable {table} listKey="task-picker:open" bind:globalFilter={query} searchPlaceholder={t('app.tasks.picker.search', 'Filter loaded tasks…')} searchAriaLabel={t('app.tasks.picker.search', 'Filter loaded tasks…')} maxHeight="35vh">
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'choose'}<button type="button" class="rounded bg-indigo-600 px-2 py-1 text-white" onclick={() => { onselect(row); open = false; }}>{t('app.tasks.picker.select', 'Select')}</button>
          {:else if cell.column.id === 'handle'}<TaskHandle handle={row.handle} />
        {:else}{String(cell.getValue() ?? '')}{/if}
        {/snippet}
      </DataTable>
      {#if !exactDone && hasMore}<button type="button" disabled={pending} class="rounded border px-3 py-1 disabled:opacity-50" onclick={() => read()}>{t('app.tasks.picker.more', 'Load more tasks')}</button>{/if}
      {#if !pending && !failed && !items.length && !exactDone}<p role="status">{includeEnded ? t('app.tasks.picker.empty-any', 'No tasks to choose from.') : t('app.tasks.picker.empty', 'No open tasks to choose from.')}</p>{/if}
    </div>
  </div>
{/if}
