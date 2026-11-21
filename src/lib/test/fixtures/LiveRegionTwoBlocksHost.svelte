<!-- Fixture for LiveRegion.client.test.ts (portal#2394): the call-site shape that leaves a text node
     inside an idle region. Two sibling blocks, as DefinitionRegisterSection and TeamGrantSection write them. -->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  let first = $state('');
  let second = $state('');
  export function say(a: string, b: string) { first = a; second = b; }
</script>

<div class="space-y-4">
  <LiveRegion class="host-region">
    {#if first}
      <p class="first">{first}</p>
    {/if}
    {#if second}
      <p class="second">{second}</p>
    {/if}
  </LiveRegion>
  <p>after</p>
</div>
