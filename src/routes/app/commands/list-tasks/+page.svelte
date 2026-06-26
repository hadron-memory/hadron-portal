<script lang="ts">
  // #392 — "List tasks": the read/list variant of a command page. Lists every
  // runnable node via the shared NodeTable (searchable); a row click opens the
  // node through the /app/u resolver. No form — the layout owns the chrome.
  import { goto } from '$app/navigation';
  import NodeTable, { type NodeRow } from '$lib/components/NodeTable.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // NB: map param is `task`, not `t` — `t` is the i18n helper imported above.
  // `nodeType` is intentionally omitted: every row here is a task, so the type
  // chip would be redundant noise (the NodeTable only renders it when present).
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
  // fragments — word order / pluralization vary by language (table-strings.ts
  // pattern). t() doesn't interpolate, so substitute after lookup.
  const countLabel = $derived(
    data.tasks.length === 1
      ? t('commands.list-tasks.count.one', '1 task')
      : t('commands.list-tasks.count.other', '{count} tasks').replace('{count}', String(data.tasks.length)),
  );
  const truncatedLabel = $derived(
    data.truncated
      ? ' ' + t('commands.list-tasks.truncated', '(showing the first {count})').replace('{count}', String(data.tasks.length))
      : '',
  );
</script>

{#if data.failed}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    {t('commands.list-tasks.failed', 'Couldn’t load tasks — the node query failed. Try again shortly.')}
  </div>
{:else}
  <p class="text-sm text-zinc-500">{countLabel}{truncatedLabel}.</p>

  <NodeTable
    nodes={rows}
    onselect={(node) => goto(`/app/u/${node.urn}`)}
    listKey="commands:list-tasks"
    pageSize={25}
    maxHeight="max(240px, calc(100vh - 22rem))"
    searchPlaceholder={t('commands.list-tasks.search-placeholder', 'Search tasks by name or description…')}
    emptyLabel={t('commands.list-tasks.empty', 'No runnable nodes in the memories you can access.')}
  />
{/if}
