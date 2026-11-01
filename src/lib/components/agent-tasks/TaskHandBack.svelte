<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { handBackLabel } from '$lib/agent-tasks/hand-back';
  import { relativeTime } from '$lib/tickers/format';
  import type { AgentTaskHandBack } from '$lib/agent-tasks/types';

  /**
   * portal#1571 (hadron-server#2651, hrn:node:hadronmemory.com:specs:cor:agt:050:01 and :29) — the task's latest hand-back, so an owner who opens a
   * re-queued task sees why it came back. Only the latest is kept; earlier ones are in the task's events. Nothing
   * shows when there is none. The text is the assignee's own and is shown as text, never as markup.
   */
  let { handBack }: { handBack?: AgentTaskHandBack | null } = $props();
</script>

{#if handBack}
  <section class="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950" data-testid="task-hand-back" aria-labelledby="task-hand-back-title">
    <h2 id="task-hand-back-title" class="text-sm font-semibold text-amber-900 dark:text-amber-200">
      {t('app.tasks.hand-back.title', 'Handed back')}
      <time datetime={handBack.handedBackAt} title={handBack.handedBackAt} class="font-normal">{relativeTime(handBack.handedBackAt, Date.now())}</time>:
      {handBackLabel(handBack.code)}
    </h2>
    {#if handBack.text}
      <p class="mt-1 text-sm whitespace-pre-line break-words text-amber-900 dark:text-amber-100" data-testid="task-hand-back-text">{handBack.text}</p>
    {/if}
  </section>
{/if}
