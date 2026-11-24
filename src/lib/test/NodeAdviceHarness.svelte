<!-- Test harness (#1371): drives NodeAdvice's prop reactively, as the app layout does when an enhanced save's invalidateAll delivers advice to an already-mounted page.
     $state.raw, not $state (#2453): load data reaches the component as the plain array the load returned. A deep $state would wrap every assigned array in a
     fresh proxy, so setting the same array twice would hand the component a different reference and the same-reference case could never be tested. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import NodeAdvice from '$lib/components/NodeAdvice.svelte';
  let { initial }: { initial: string[] } = $props();
  let advice = $state.raw(untrack(() => initial));
  export function setAdvice(a: string[]) { advice = a; }
</script>

<NodeAdvice {advice} />
