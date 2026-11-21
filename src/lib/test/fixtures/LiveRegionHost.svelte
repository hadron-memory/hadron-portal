<!-- Fixture for LiveRegion.client.test.ts: drives the same shape the call sites use
     (a styled box that exists only while there is something to say). -->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  let text = $state('');
  export function say(next: string) { text = next; }
</script>

<LiveRegion class="host-region">
  {#if text}
    <div class="host-box">{text}</div>
  {/if}
</LiveRegion>
