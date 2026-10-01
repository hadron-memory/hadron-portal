<script lang="ts">
  /**
   * #988 — why a Git-synced memory's last sync failed. Shown under the sync
   * status on the memory's Info and Integrations pages when it is `ERROR`.
   * Never renders the server's text unredacted (see $lib/sync-error).
   */
  import { t } from '$lib/i18n/t';
  import { syncErrorView } from '$lib/sync-error';

  let { syncError }: { syncError: string | null | undefined } = $props();
  const view = $derived(syncErrorView(syncError));
</script>

<div role="status" class="px-5 py-3 text-sm text-red-700 dark:text-red-300">
  {#if view.kind === 'review-required'}
    <p>{t('sync-error.review-required', 'This sync was held for review: some files that this memory’s nodes came from are missing from the branch it syncs from, so the sync stopped instead of deleting those nodes.')}</p>
    <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('sync-error.review-required.next', 'If the memory should sync from a different branch, set its Read branch in Integrations, then sync again.')}</p>
  {:else}
    <p>{t('sync-error.failed', 'The last sync failed.')}</p>
    {#if view.detail}
      <p class="mt-1 break-words font-mono text-xs text-zinc-600 dark:text-zinc-400">{view.detail}</p>
    {/if}
  {/if}
</div>
