<!--
  portal#1052, #1090 — the one quiet line that says where task writes happen.
  The board's writes are on a task's page and in the CLI or MCP; Roster and
  Alarms stay read-only (design agent-task-writes §8). The task page says
  where the right to change it comes from in its action bar instead.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { view = 'board' }: { view?: 'board' | 'roster' | 'composition' | 'alarms' } = $props();
</script>

<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400" data-testid="tasks-read-only">
  {view === 'board'
    ? t('app.tasks.write.board-note', 'Create a task with New task; direct it from its page, the CLI or MCP.')
    : t('app.tasks.read-only.view', 'This view is read-only.')}
</p>
