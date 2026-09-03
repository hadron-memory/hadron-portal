<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // #782/#788's shape: an async onMount that awaits, then touches a bind:this.
  // `guard` selects the fixed version so one fixture pins BOTH directions —
  // a fixture that only reproduced the bug could not show the guard works.
  let { guard = false, log }: { guard?: boolean; log: string[] } = $props();

  // Typed `| undefined` deliberately: Svelte CLEARS a bind:this on teardown, so
  // a bare `HTMLDivElement` is a lie that switches off the only check that
  // could catch this (#782's root cause).
  let el: HTMLDivElement | undefined = $state();
  let destroyed = false;
  onDestroy(() => { destroyed = true; });

  onMount(async () => {
    await Promise.resolve();
    if (guard && (destroyed || !el)) { log.push('guarded'); return; }
    // Unguarded this throws on a torn-down component, exactly like
    // `new vis.Network(null, …)` did.
    log.push(`touched:${el!.tagName}`);
  });
</script>
<div bind:this={el}>probe</div>
