<script lang="ts">
  // #392 — "List tasks": the read/list variant of a command page. Lists every
  // runnable node via the shared NodeTable (searchable); a row click opens the
  // node through the /app/u resolver. No form — the layout owns the chrome.
  import { goto } from '$app/navigation';
  import NodeTable, { type NodeRow } from '$lib/components/NodeTable.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const rows = $derived<NodeRow[]>(
    data.tasks.map((t) => ({
      id: t.id,
      loc: t.loc,
      name: t.name,
      description: t.description,
      nodeType: t.nodeType,
      urn: t.urn,
    })),
  );
</script>

{#if data.failed}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    Couldn’t load tasks — the node query failed. Try again shortly.
  </div>
{:else}
  <p class="text-sm text-zinc-500">
    {data.tasks.length}
    {data.tasks.length === 1 ? 'task' : 'tasks'}{data.truncated ? ` (showing the first ${data.tasks.length})` : ''}.
  </p>

  <NodeTable
    nodes={rows}
    onselect={(node) => goto(`/app/u/${node.urn}`)}
    searchPlaceholder="Search tasks by name or description…"
    emptyLabel="No runnable nodes in the memories you can access."
  />
{/if}
