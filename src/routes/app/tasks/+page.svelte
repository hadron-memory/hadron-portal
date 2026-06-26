<script lang="ts">
  // "Task Nodes" top-level page (promoted out of /app/commands/list-tasks).
  // Lists every runnable node via the shared NodeTable (searchable, paginated,
  // saved views); a row click opens the node through the /app/u resolver. Owns
  // its own header chrome — it no longer lives under the commands layout.
  import { goto } from '$app/navigation';
  import NodeTable, { type NodeRow } from '$lib/components/NodeTable.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // NB: map param is `task`, not `t` — `t` is the i18n helper imported above.
  // `nodeType` is intentionally omitted: every row is a task, so the type chip
  // would be redundant (NodeTable only renders it when present).
  const rows = $derived<NodeRow[]>(
    data.tasks.map((task) => ({
      id: task.id,
      loc: task.loc,
      name: task.name,
      description: task.description,
      urn: task.urn,
    })),
  );

  // Whole-phrase strings with a {count} placeholder rather than concatenated
  // fragments — word order / pluralization vary by language. t() doesn't
  // interpolate, so substitute after lookup.
  const countLabel = $derived(
    data.tasks.length === 1
      ? t('tasks.count.one', '1 task')
      : t('tasks.count.other', '{count} tasks').replace('{count}', String(data.tasks.length)),
  );
  const truncatedLabel = $derived(
    data.truncated
      ? ' ' + t('tasks.truncated', '(showing the first {count})').replace('{count}', String(data.tasks.length))
      : '',
  );
</script>

<svelte:head><title>{t('tasks.title', 'Task Nodes')} · Hadron</title></svelte:head>

<div class="space-y-6">
  <header class="space-y-1">
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">{t('tasks.title', 'Task Nodes')}</h1>
    <p class="text-sm text-zinc-500">
      {t('tasks.description', 'Every runnable node (a task) across the memories you can access.')}
    </p>
  </header>

  {#if data.failed}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {t('tasks.failed', 'Couldn’t load tasks — the node query failed. Try again shortly.')}
    </div>
  {:else}
    <p class="text-sm text-zinc-500">{countLabel}{truncatedLabel}.</p>

    <NodeTable
      nodes={rows}
      onselect={(node) => goto(`/app/u/${node.urn}`)}
      listKey="tasks"
      pageSize={25}
      maxHeight="max(240px, calc(100vh - 18rem))"
      searchPlaceholder={t('tasks.search-placeholder', 'Search tasks by name or description…')}
      emptyLabel={t('tasks.empty', 'No runnable nodes in the memories you can access.')}
    />
  {/if}
</div>
