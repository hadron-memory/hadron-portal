<!--
  #914 — who or what wrote a content state, as the server attributes it.
  A task is linked only through /app/u/<urn> (access-checked there); a task the
  viewer can't read is "not available to you", never named or guessed.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { authorshipText, type AuthorshipView } from '$lib/node-provenance';

  let { view, compact = false }: { view: AuthorshipView; compact?: boolean } = $props();
</script>

{#if view.kind === 'task'}
  <span data-testid="authorship-task" class="text-sm text-zinc-900 dark:text-white">
    {t('node.authorship.task-prefix', 'Written with')}
    <a href={view.task.href} class="break-all font-mono text-indigo-600 hover:underline dark:text-indigo-400">{view.task.urn}</a>
    {#if view.task.revision != null}
      <span class="whitespace-nowrap">{t('node.authorship.task-rev-suffix', '(revision {rev})', { rev: view.task.revision })}</span>
    {/if}
  </span>
  {#if !compact}
    <span data-testid="authorship-task-note" class="block text-xs text-zinc-500 dark:text-zinc-400">
      {t('node.authorship.task-note', "This records the task used. It doesn't show that the content follows it.")}
    </span>
  {/if}
{:else}
  <span
    data-testid="authorship-{view.kind}"
    class="text-sm {view.kind === 'human' ? 'text-zinc-900 dark:text-white' : 'italic text-zinc-500 dark:text-zinc-400'}"
  >{authorshipText(view)}</span>
{/if}
