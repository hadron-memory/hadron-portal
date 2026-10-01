<script lang="ts">
  /**
   * #988 — why a Git-synced memory's last sync failed. Shown under the sync
   * status on the memory's Info and Integrations pages when it is `ERROR`.
   * Renders fixed copy chosen by classifying the server's text; the text
   * itself is never shown, because it can carry credentials ($lib/sync-error).
   */
  import { gitFailureMessage } from '$lib/sync-error';

  let { syncError }: { syncError: string | null | undefined } = $props();
  const text = $derived(gitFailureMessage(syncError, 'sync'));
</script>

<div role="status" class="px-5 py-3 text-sm text-red-700 dark:text-red-300">
  <p>{text}</p>
</div>
