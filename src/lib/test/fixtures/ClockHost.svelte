<script lang="ts">
  // A mount host shaped exactly like the pages' wiring of the display clock
  // (portal#1495): one clock per instance, started from `$effect`, stopped on
  // destroy. Exists so the clock's client tests can pin the mount-lifetime
  // contract — one interval for the whole mounted life, no per-tick
  // re-creation (#1618 LOCAL P3) — without standing up a whole page.
  import { createDisplayClock } from '$lib/workers/display-clock.svelte';

  let { seed }: { seed: string } = $props();

  // The seed is read ONCE, deliberately — same rationale as the pages: the
  // offset (loader clock vs browser clock at first paint) is a property of
  // the viewer, and later ticks carry the offset, not the seed.
  // svelte-ignore state_referenced_locally
  const clock = createDisplayClock(seed);
  $effect(() => {
    clock.start();
    return clock.stop;
  });
</script>

<span data-clock={clock.now}>{clock.now}</span>
