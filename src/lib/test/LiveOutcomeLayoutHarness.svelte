<script lang="ts">
 import LiveOutcome from '$lib/components/LiveOutcome.svelte';
 import LiveRegion from '$lib/components/LiveRegion.svelte';
 // The same space-y column rendered the old way (a conditional box) and with each live-region shape,
 // so a browser can compare their heights (portal#2379: layout unchanged at converted sites).
 let { mode = 'plain', note = null, trailing = false }: { mode?: 'plain' | 'region' | 'outcome'; note?: { text: string; failed: boolean } | null; trailing?: boolean } = $props();
</script>
<div data-testid="column" class="flow-root space-y-3">
 <p>Above the message</p>
 {#if mode === 'plain'}
  {#if note}<p class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}
 {:else if mode === 'region'}
  <LiveRegion>{#if note}<p class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}</LiveRegion>
 {:else}
  <LiveOutcome failed={note?.failed ?? false}>{#if note}<p class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}</LiveOutcome>
 {/if}
 {#if trailing}<button type="button">After the message</button>{/if}
</div>
