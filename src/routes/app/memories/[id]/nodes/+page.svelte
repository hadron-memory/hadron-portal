<script lang="ts">
  // #266: Nodes tab — the flat node list (MemoryBrowser with the view fixed to
  // nodes; it keeps the shared tree sidebar, filters, and search).
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const basePath = $derived(`/app/memories/${data.graph.id}`);
</script>

<svelte:head><title>{data.graph.name} &middot; Nodes &middot; Hadron</title></svelte:head>

<MemoryBrowser nodes={data.graphNodes ?? []} {basePath} forcedView="nodes" />
