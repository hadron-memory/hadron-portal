<!-- Test harness (#1371): drives NodeAdvice's prop reactively, as the app layout does when an enhanced save's invalidateAll delivers advice to an already-mounted page. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import NodeAdvice from '$lib/components/NodeAdvice.svelte';
  let { initial }: { initial: string[] } = $props();
  let advice = $state(untrack(() => initial));
  export function setAdvice(a: string[]) { advice = a; }
</script>

<NodeAdvice {advice} />
