<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { AiConfigTestView } from '$lib/ai-config-test';
  let { result }: { result: AiConfigTestView | null } = $props();
</script>

<!-- Two fixed outcome fields, not an entity list: retain the existing feedback card. -->
<div class="space-y-2" aria-live="polite" data-testid="ai-config-test-feedback">
  {#if result}
  <div data-testid="ai-config-test-run"
    class="rounded-md border px-3 py-2 text-xs {result.ok
      ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'}">
    {#if result.labelledLegs}<p class="font-semibold">{t('ai-config.test.run-label', 'Run')}</p>{/if}
    <p>{result.ok ? '' : '× '}{result.headline}</p>
    {#each result.details as detail, i (i)}<p class="mt-0.5 opacity-80">{detail}</p>{/each}
  </div>
  {#if result.chat}
    <div data-testid="ai-config-test-chat"
      class="rounded-md border px-3 py-2 text-xs {result.chat.ok
        ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
        : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'}">
      <p class="font-semibold">{t('ai-config.test.chat-label', 'Chat')}</p>
      <p>{result.chat.ok ? '' : '× '}{result.chat.headline}</p>
    </div>
  {/if}
  {/if}
</div>
