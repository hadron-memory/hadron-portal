<script lang="ts">
  // portal#1433: the app layout's real route-keyed outlet around the REAL
  // `(browser)` group layout. SvelteKit decides which layouts a route renders;
  // this harness stands in for that by group membership of the route id (the
  // filesystem half is pinned in memory-browser-routes.test.ts), so what is
  // under test here is the part the portal owns: the outlet key and the one
  // mounted MemoryBrowser.
  import AppLayout from '../../../routes/app/+layout.svelte';
  import BrowserLayout from '../../../routes/app/memories/[id]/(browser)/+layout.svelte';
  import { page } from '$app/stores';
  const data = {
    graph: { id: 'mem-a', urn: 'hrn:mem:acme.com:mem-a', name: 'A' },
    canWriteMemory: true,
    graphNodes: [],
    nodesTotal: 0,
    nodesFailed: false,
  };
  const inGroup = $derived(($page.route.id ?? '').includes('/(browser)/'));
</script>
<AppLayout data={{ activeOrgId: null, isConsumerMode: false, user: { handle: 'synthetic' } } as never}>
  {#if inGroup}
    <BrowserLayout data={data as never}><span data-testid="page-child"></span></BrowserLayout>
  {:else}
    <span data-testid="outside-group"></span>
  {/if}
</AppLayout>
