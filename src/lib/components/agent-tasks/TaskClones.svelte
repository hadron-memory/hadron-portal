<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import TaskHandle from './TaskHandle.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { taskChoiceStatus } from '$lib/agent-tasks/planning';
  import { taskHref } from '$lib/agent-tasks/handle';
  import { t } from '$lib/i18n/t';
  import type { TaskChoice, TaskClonesPage, TaskRead } from '$lib/agent-tasks/types';

  /**
   * portal#2161 (hadron-server#3244, hrn:node:hadronmemory.com:specs:cor:agt:050:02): the tasks
   * cloned from this one, paged (hrn:node:hadronmemory.com:specs:cor:api:120:04), in the shared
   * TanStack grid like the sibling relations list — the rows are the same Task/Handle/Status shape.
   * The server leaves out a clone this caller can't read, so every row it returns is a readable
   * task in this App — the portal adds no visibility rule of its own. Nothing renders when the
   * list is empty; a failed read is unknown, never none, so it says so instead of hiding.
   *
   * SvelteKit reuses this component across /tasks/[taskId] navigations (a clone link is how you
   * leave this page), so the view is re-seeded on an identity change and a pending Load-more page
   * is fenced by generation — the TaskPlanning relation pattern, not a mount-time seed.
   */
  let {
    initial,
    appId,
    taskId,
    basePath,
  }: {
    initial: TaskRead<TaskClonesPage>;
    appId: string;
    taskId: string;
    basePath: string;
  } = $props();

  let view = $state<TaskRead<TaskClonesPage>>(untrack(() => initial));
  let pending = $state(false);
  let failed = $state(false);
  // A page from before a task change, a loader refresh or destruction must never land in the view.
  let generation = 0;
  let scope = untrack(() => `${appId}:${taskId}`);
  let lastInitial = untrack(() => initial);
  $effect(() => {
    const source = initial;
    const next = `${appId}:${taskId}`;
    untrack(() => {
      generation++;
      // A new task without a fresh read is unknown, never the old task's rows.
      view = next !== scope && source === lastInitial ? { kind: 'failed' } : source;
      scope = next;
      lastInitial = source;
      pending = false;
      failed = false;
    });
  });
  onDestroy(() => { generation++; });

  const items = $derived<TaskChoice[]>(view.kind === 'ok' ? view.value.items : []);
  const total = $derived(view.kind === 'ok' ? view.value.total : 0);
  const hasMore = $derived(view.kind === 'ok' ? view.value.hasMore : false);

  const columns: PortalColumnDef<TaskChoice>[] = [
    { accessorKey: 'title', header: t('app.tasks.col.task', 'Task'), size: 240 },
    { accessorKey: 'handle', header: t('app.tasks.col.handle', 'Handle'), size: 150 },
    { accessorKey: 'status', accessorFn: (row) => taskChoiceStatus(row.status), header: t('app.tasks.col.status', 'Status'), size: 120 },
  ];
  const table = createSvelteTable<TaskChoice>({
    get data() { return items; },
    columns,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  async function loadMore() {
    if (pending || view.kind !== 'ok' || !view.value.hasMore) return;
    const current = generation;
    const targetApp = appId;
    const targetTask = taskId;
    const offset = view.value.items.length;
    pending = true;
    failed = false;
    try {
      const response = await fetch(
        `/app/apps/${encodeURIComponent(targetApp)}/tasks/${encodeURIComponent(targetTask)}/relations?direction=clones&offset=${offset}`,
      );
      if (!response.ok) throw new Error('unavailable');
      const result: TaskRead<TaskClonesPage> = await response.json();
      if (current !== generation) return;
      if (
        view.kind !== 'ok' ||
        result.kind !== 'ok' ||
        !Array.isArray(result.value.items) ||
        typeof result.value.hasMore !== 'boolean' ||
        typeof result.value.total !== 'number' ||
        result.value.total < 0 ||
        result.value.items.length > 200 ||
        result.value.items.some((row) => row.appId !== targetApp)
      ) {
        throw new Error('unavailable');
      }
      const page = result.value;
      // hasMore with an empty page is a transport lie, not the end of the list.
      if (page.hasMore && page.items.length === 0) throw new Error('unavailable');
      // Overlap reveals concurrent clone writes; appending a duplicate would break the row keys,
      // so nothing is appended and the person reloads (the TaskPlanning shifted-page rule).
      const seen = new Set(view.value.items.map((row) => row.id));
      if (page.items.some((row) => seen.has(row.id))) {
        failed = true;
        return;
      }
      view = { kind: 'ok', value: { items: [...view.value.items, ...page.items], total: page.total, hasMore: page.hasMore } };
    } catch {
      if (current === generation) failed = true;
    } finally {
      if (current === generation) pending = false;
    }
  }
</script>

{#if view.kind === 'failed'}
  <section aria-labelledby="clones-heading" class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 id="clones-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.clones', 'Clones')}</h2>
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('app.tasks.clones.failed', 'Couldn’t load the clones. Reload the page to try again.')}
    </div>
  </section>
{:else if items.length > 0 || total > 0}
  <section aria-labelledby="clones-heading" class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" data-testid="task-clones">
    <h2 id="clones-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.clones', 'Clones')}</h2>
    <div class="min-w-0">
      <DataTable {table} listKey="task-clones" searchPlaceholder={t('app.tasks.clones.search', 'Filter loaded clones…')} searchAriaLabel={t('app.tasks.clones.search', 'Filter loaded clones…')} bounded>
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'title'}<a href={taskHref(basePath, row)} class="text-indigo-700 underline dark:text-indigo-300">{row.title}</a>
          {:else if cell.column.id === 'handle'}<TaskHandle handle={row.handle} />
          {:else}{String(cell.getValue() ?? '')}{/if}
        {/snippet}
      </DataTable>
    </div>
    {#if total > items.length}
      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.clones.loaded-only', 'Search and table pages cover loaded clones only.')}</p>
    {/if}
    {#if hasMore}
      <!-- Never page one as the whole set: the server said there are more (hrn:node:hadronmemory.com:specs:cor:api:120:04). -->
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onclick={loadMore}
          class="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          data-testid="clones-more"
        >{t('app.tasks.clones.more', 'Load more clones')}</button>
        {#if total > items.length}
          <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.clones.showing', 'Showing {shown} of {total}', { shown: items.length, total })}</span>
        {/if}
      </div>
    {:else if total > items.length}
      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.clones.rest-hidden', '{n} clone(s) aren’t shown.', { n: total - items.length })}</p>
    {/if}
    {#if failed}
      <p role="alert" class="mt-2 text-sm text-red-700 dark:text-red-300">{t('app.tasks.clones.load-failed', 'Couldn’t load more clones. Try again.')}</p>
    {/if}
  </section>
{/if}
