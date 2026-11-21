<script lang="ts">
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  let note = $state<{ text: string; failed: boolean } | null>(null);
  export function say(next: { text: string; failed: boolean } | null) { note = next; }
</script>
<LiveOutcome failed={note?.failed ?? false} class="host-outcome">
  {#if note}<p class="host-box">{note.text}</p>{/if}
</LiveOutcome>
