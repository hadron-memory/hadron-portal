<!--
  portal#1052 — the subtasks below one task (design §5.2), in the server's
  order (depth, then creation). A tree, not a DataTable: the data is a
  hierarchy and the row order is the information (CLAUDE.md's stated
  exception).

  Nested lists with a disclosure button per branch (`aria-expanded`,
  `aria-controls`), open to depth 3 by default. No arrow-key tree widget is
  claimed: every row is an ordinary link reachable by Tab.
-->
<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/i18n/t';
  import { fmtRunTime } from '$lib/flow/runs';
  import { buildSubtaskTree, type SubtaskNode } from '$lib/agent-tasks/tree';
  import type { AgentTaskRow } from '$lib/agent-tasks/types';
  import PartyLabel from './PartyLabel.svelte';
  import TaskStateChips from './TaskStateChips.svelte';

  let { rows, rootId, basePath }: { rows: AgentTaskRow[]; rootId: string; basePath: string } = $props();

  const roots = $derived(buildSubtaskTree(rows, rootId));
  /** Branches the reader collapsed or opened, by id; the default is open above depth 3. */
  const toggled = new SvelteSet<string>();
  const isOpen = (n: SubtaskNode) => (n.depth < 3) !== toggled.has(n.task.id);
  function toggle(id: string) {
    if (toggled.has(id)) toggled.delete(id);
    else toggled.add(id);
  }
</script>

{#snippet branch(nodes: SubtaskNode[], listId: string | undefined)}
  <ul id={listId} class="space-y-1 {listId ? 'ml-5 mt-1 border-l border-zinc-200 pl-3 dark:border-zinc-700' : ''}">
    {#each nodes as node (node.task.id)}
      <li>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
          {#if node.children.length > 0}
            <button
              type="button"
              onclick={() => toggle(node.task.id)}
              aria-expanded={isOpen(node)}
              aria-controls={isOpen(node) ? `subtasks-of-${node.task.id}` : undefined}
              aria-label={isOpen(node)
                ? t('app.tasks.tree.collapse', 'Hide subtasks of {title}', { title: node.task.title })
                : t('app.tasks.tree.expand', 'Show subtasks of {title}', { title: node.task.title })}
              class="w-5 shrink-0 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >{isOpen(node) ? '▾' : '▸'}</button>
          {:else}
            <span class="w-5 shrink-0" aria-hidden="true"></span>
          {/if}
          <TaskStateChips task={node.task} />
          <a href="{basePath}/tasks/{node.task.id}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{node.task.title}</a>
          <span class="text-xs text-zinc-500 dark:text-zinc-400"><PartyLabel party={node.task.assignee} showUrn={false} /></span>
          <span class="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{fmtRunTime(node.task.updatedAt ?? node.task.createdAt)}</span>
        </div>
        {#if node.children.length > 0 && isOpen(node)}
          {@render branch(node.children, `subtasks-of-${node.task.id}`)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#if roots.length === 0}
  <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="no-subtasks">{t('app.tasks.tree.none', 'No subtasks')}</p>
{:else}
  {@render branch(roots, undefined)}
{/if}
