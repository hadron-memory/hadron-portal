<script lang="ts">
  // #266: Graph tab — the topic graph + tree (MemoryBrowser with the view fixed
  // to graph; it keeps the shared tree sidebar, filters, and search).
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const basePath = $derived(`/app/memories/${data.graph.id}`);
</script>

<svelte:head><title>{data.graph.name} &middot; Graph &middot; Hadron</title></svelte:head>

<MemoryBrowser nodes={data.graphNodes ?? []} {basePath} forcedView="graph" />
