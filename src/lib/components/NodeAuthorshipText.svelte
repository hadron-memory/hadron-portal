<!--
  #914 — who or what wrote a content state, as the server attributes it.
  Referenced tasks and people render through the shared Urn component (AGENTS.md
  "A referenced object shows its URN"); a task links only via /app/u/<urn>,
  which is access-checked there. A task the viewer can't read is "not
  available to you", never named or guessed.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { authorshipText, type AuthorshipView } from '$lib/node-provenance';
  import Urn from './Urn.svelte';

  let { view, compact = false }: { view: AuthorshipView; compact?: boolean } = $props();
</script>

{#if view.kind === 'task'}
  <span data-testid="authorship-task" class="inline-flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-sm text-zinc-900 dark:text-white">
    <span>{t('node.authorship.task-prefix', 'Written with')}</span>
    <Urn value={view.task.urn} type="node" linked size={compact ? 9 : 10} />
    {#if view.task.revision != null}
      <span class="whitespace-nowrap">{t('node.authorship.task-rev-suffix', '(revision {rev})', { rev: view.task.revision })}</span>
    {/if}
  </span>
  {#if !compact}
    <span data-testid="authorship-task-note" class="block text-xs text-zinc-500 dark:text-zinc-400">
      {t('node.authorship.task-note', "This records the task used. It doesn't show that the content follows it.")}
    </span>
  {/if}
{:else if view.kind === 'human'}
  <span data-testid="authorship-human" class="inline-flex min-w-0 flex-col items-end gap-1">
    <span class="text-sm text-zinc-900 dark:text-white">{authorshipText(view)}</span>
    {#if view.urn}
      <Urn value={view.urn} type="user" linked size={compact ? 9 : 10} />
    {/if}
  </span>
{:else}
  <span data-testid="authorship-{view.kind}" class="text-sm italic text-zinc-500 dark:text-zinc-400">{authorshipText(view)}</span>
{/if}
