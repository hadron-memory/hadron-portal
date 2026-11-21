<!--
  #914 — advisory content validation (server #1326). Never styled as an error:
  a failed or out-of-date check doesn't block editing, and it isn't schema or
  platform validation.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { authorCheckText, validationText, type ValidationView } from '$lib/node-provenance';
  import Urn from './Urn.svelte';

  let { view, compact = false }: { view: ValidationView; compact?: boolean } = $props();

  const toneClass = $derived(
    view.tone === 'pass'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : view.tone === 'attention'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  );
</script>

<span class="inline-flex flex-col items-end gap-1 text-right">
  <span data-testid="validation-state" data-state={view.state} class="rounded-full px-2 py-0.5 text-xs font-medium {toneClass}">
    {validationText(view)}
  </span>
  {#if !compact && view.report}
    <span data-testid="validation-detail" class="text-xs text-zinc-500 dark:text-zinc-400">
      {t('node.validation.checked', 'Checked revision {rev} on {when}', {
        rev: view.report.nodeRevision,
        when: new Date(view.report.reportedAt).toLocaleString(),
      })}
      {#if view.task}
        · {t('node.validation.with', 'with')}
        <Urn value={view.task.urn} type="node" linked size={9} />
        {#if view.task.revision != null}
          {t('node.authorship.task-rev-suffix', '(revision {rev})', { rev: view.task.revision })}
        {/if}
      {:else}
        · {t('node.validation.task-unavailable', "with a task that isn't available to you")}
      {/if}
    </span>
  {/if}
  {#if !compact && view.authorCheck}
    <span data-testid="validation-author-check" class="text-xs text-zinc-500 dark:text-zinc-400">{authorCheckText(view)}</span>
  {/if}
  {#if !compact && (view.state === 'FAIL' || view.state === 'ERROR' || view.state === 'STALE')}
    <span data-testid="validation-advisory" class="text-xs text-zinc-500 dark:text-zinc-400">
      {t('node.validation.advisory', "Advisory: it doesn't block editing, and it's separate from schema validation.")}
    </span>
  {/if}
</span>
