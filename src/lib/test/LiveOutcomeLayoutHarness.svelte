<script lang="ts">
 import LiveOutcome from '$lib/components/LiveOutcome.svelte';
 import LiveRegion from '$lib/components/LiveRegion.svelte';
 // The same space-y column rendered the old way (a conditional box) and with each live-region shape,
 // so a browser can compare their geometry (portal#2379: layout unchanged at converted sites). The note
 // changes on the MOUNTED fixture, as a real outcome does, and the message box and the control after it
 // carry test ids so their positions can be compared, not only the column's height.
 let { mode = 'plain', hasFollowingControl = false }: { mode?: 'plain' | 'region' | 'outcome'; hasFollowingControl?: boolean } = $props();
 let note = $state<{ text: string; failed: boolean } | null>(null);
 export function say(next: { text: string; failed: boolean } | null) { note = next; }
</script>
<div data-testid="column" class="flow-root space-y-3">
 <p>Above the message</p>
 {#if mode === 'plain'}
  {#if note}<p data-testid="msg" class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}
 {:else if mode === 'region'}
  <LiveRegion>{#if note}<p data-testid="msg" class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}</LiveRegion>
 {:else}
  <LiveOutcome failed={note?.failed ?? false}>{#if note}<p data-testid="msg" class="rounded-lg border px-3 py-2 text-sm">{note.text}</p>{/if}</LiveOutcome>
 {/if}
 {#if hasFollowingControl}<button data-testid="after" type="button">After the message</button>{/if}
</div>
