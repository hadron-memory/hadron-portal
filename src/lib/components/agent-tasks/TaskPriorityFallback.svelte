<script lang="ts">
  /**
   * portal#2261 (Jack's P2#4 on #2263) — what the Priority and blockers section shows until it has
   * been read, and what a reader without JavaScript keeps: on main the priority form was in the
   * server-rendered page and saved by a plain POST to `?/priority`. Deferring the section must not
   * take that away, so the form is here as a native form (no enhance needed); the section replaces
   * it once its relations arrive.
   */
  import { t } from '$lib/i18n/t';
  import { canSetPriority } from '$lib/agent-tasks/planning';
  import type { AgentTaskDetail } from '$lib/agent-tasks/types';

  let { task, canWrite, label }: { task: AgentTaskDetail; canWrite: boolean; label: string } = $props();
</script>

<section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="task-planning">
  <h2 id="task-planning" class="font-semibold text-zinc-900 dark:text-white">{t('app.tasks.planning', 'Priority and blockers')}</h2>
  {#if canSetPriority(task, canWrite)}
    <form method="POST" action="?/priority" class="flex flex-wrap items-end gap-2">
      <label for="task-priority" class="text-sm">{t('app.tasks.priority.edit-label', 'Priority (1 is highest)')}</label>
      <select id="task-priority" name="priority" class="ml-2 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600">
        {#each [1, 2, 3, 4, 5] as value}<option value={String(value)} selected={task.priority === value}>{value}</option>{/each}
      </select>
      <button class="rounded border px-3 py-1 text-sm">{t('app.tasks.priority.save', 'Save priority')}</button>
    </form>
  {:else}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.priority', 'Priority')}: {task.priority ?? '—'} <span class="text-xs">{t('app.tasks.priority.highest', '(1 is highest)')}</span></p>
  {/if}
  <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
</section>
