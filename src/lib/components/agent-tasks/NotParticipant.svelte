<!--
  portal#1052 — what a task read's APP_NOT_FOUND means here (design §8): the
  viewer can see the App but doesn't take part in its tasks
  (hrn:node:hadronmemory.com:specs:cor:agt:050:21). An inline state, not an
  error page, so the App header and the page around it stay.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { impersonating = null }: { impersonating?: string | null } = $props();
</script>

<div role="status" class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900" data-testid="tasks-not-participant">
  <p class="font-medium text-zinc-900 dark:text-white">{t('app.tasks.not-participant.title', 'You don’t take part in this App’s tasks.')}</p>
  <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
    {t('app.tasks.not-participant.body', 'Tasks, the roster and alarms are visible to the App’s owner and members. If you should see them, ask the App’s owner to add you.')}
  </p>
  {#if impersonating}
    <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">
      {t('app.tasks.not-participant.impersonating', 'You’re viewing as {user}, who doesn’t take part.', { user: impersonating })}
    </p>
  {/if}
</div>
