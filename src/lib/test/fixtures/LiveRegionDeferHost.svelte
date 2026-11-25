<!-- Fixture for LiveRegion.deferFirst.client.test.ts (portal#2388): one region whose `deferFirst` follows the `defer` prop (on by default),
     holding text from its first render, as a host that mounts and starts its read together does. -->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  let { defer = true }: { defer?: boolean } = $props();
</script>

<LiveRegion deferFirst={defer} data-testid="host-region"><p class="host-text">Loading…</p></LiveRegion>
