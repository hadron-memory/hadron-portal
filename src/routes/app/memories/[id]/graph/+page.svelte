<script lang="ts">
  // #266: Graph tab. The MemoryBrowser (forced to the graph view) is rendered by
  // the persistent +layout.svelte so its state survives Nodes↔Graph switches;
  // this page only sets the title.
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.graph.name} &middot; Graph &middot; Hadron</title></svelte:head>
