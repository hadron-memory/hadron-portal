<!-- Test harness (#498): drives RawKeyReveal's props reactively, as the page does when a second mint replaces the first. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import RawKeyReveal from '$lib/components/RawKeyReveal.svelte';
  let { initial, ttlMs, ondismiss }: { initial: string; ttlMs: number; ondismiss: () => void } = $props();
  let key = $state(untrack(() => initial));
  export function setKey(k: string) { key = k; }
</script>

<RawKeyReveal rawKey={key} {ttlMs} {ondismiss} />
