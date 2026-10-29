<script lang="ts">
  import { t } from '$lib/i18n/t';
  let { advice }: { advice: string[] } = $props();
</script>

{#if advice.length}
  <div role="status" class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="node-save-advice">
    <p class="font-semibold">{t('node.save.advice.title', 'Advice from a saved change')}</p>
    {#each advice as text}<p class="mt-1">{text}</p>{/each}
  </div>
{/if}
