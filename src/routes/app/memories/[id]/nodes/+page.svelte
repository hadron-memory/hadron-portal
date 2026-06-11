<script lang="ts">
  // #266: Nodes tab. The MemoryBrowser (forced to the nodes view) is rendered by
  // the persistent +layout.svelte so its state survives Nodes↔Graph switches;
  // this page only sets the title.
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.graph.name} &middot; Nodes &middot; Hadron</title></svelte:head>
