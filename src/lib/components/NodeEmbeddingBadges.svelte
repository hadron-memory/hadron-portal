<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { enabled, pendingAt, failedAt, error }: {
    enabled: boolean;
    pendingAt?: string | null;
    failedAt?: string | null;
    error?: string | null;
  } = $props();
</script>

{#if enabled && (pendingAt || failedAt)}
  <div data-testid="node-embedding-state" class="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
    {#if pendingAt}
      <span data-testid="embedding-pending" class="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        {t('node.embedding.pending', 'Embedding pending')}
      </span>
    {/if}
    {#if failedAt}
      <span data-testid="embedding-failed" class="min-w-0 max-w-full break-words rounded-lg bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
        {t('node.embedding.failed', 'Embedding failed')}{#if error}: {error}{/if}
      </span>
    {/if}
  </div>
{/if}
