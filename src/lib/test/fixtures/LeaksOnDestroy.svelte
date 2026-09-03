<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // #788's other half: dropping a reference is not disposal. `live` stands in
  // for a third-party instance (vis-network) that keeps running until its own
  // destroy() is called.
  let { dispose = false, registry }: { dispose?: boolean; registry: { live: number } } = $props();
  let handle: { stop: () => void } | undefined;

  onMount(() => {
    registry.live += 1;
    handle = { stop: () => { registry.live -= 1; } };
  });

  onDestroy(() => {
    // The buggy version only drops the reference.
    if (dispose) handle?.stop();
    handle = undefined;
  });
</script>
<div>leaky</div>
