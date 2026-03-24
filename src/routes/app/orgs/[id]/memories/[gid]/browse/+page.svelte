<script lang="ts">
  import { page } from '$app/stores';
  import TopicGraph from '$lib/components/TopicGraph.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}/memories/${data.graph.id}`);
  const focusId = $derived($page.url.searchParams.get('focus') ?? undefined);
</script>

<svelte:head><title>{data.graph.name} &middot; Browse &middot; Hadron</title></svelte:head>

{#if data.graphViewData.topics.length === 0}
  <div class="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style="min-height: 500px;">
    No nodes in this graph yet. Sync the graph or create nodes to get started.
  </div>
{:else}
  <div class="overflow-hidden rounded-r-lg border border-zinc-200 dark:border-zinc-800" style="min-height: 600px; display: flex;">
    <TopicGraph data={data.graphViewData} {focusId} {basePath} />
  </div>
{/if}
