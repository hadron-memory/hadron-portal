<!--
  portal#2436 item 6: a change request that was waiting could not be read on this load. It is
  re-checked on the next few visits (READ_FAILURE_LIMIT in a row, then no longer tracked); say so rather
  than letting its notice vanish.
  The live region is always mounted (portal#2344) so the note is announced when it appears.
  `count` is how many reads failed (portal#2578: the notice names the number, not just "a").
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { t } from '$lib/i18n/t';

  let { count }: { count: number } = $props();
</script>

<LiveRegion data-testid="pending-unread-region">
  {#if count === 1}
    <p class="text-sm text-red-700 dark:text-red-400" data-testid="pending-unread">{t('secrets.pending.unread', "Couldn't check a change request that was waiting for your signature. It is checked again on your next few visits, then no longer tracked here.")}</p>
  {:else if count > 1}
    <p class="text-sm text-red-700 dark:text-red-400" data-testid="pending-unread">{t('secrets.pending.unread.many', "Couldn't check {count} change requests that were waiting for your signature. They are checked again on your next few visits, then no longer tracked here.", { count })}</p>
  {/if}
</LiveRegion>
