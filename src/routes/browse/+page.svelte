<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Browse public graphs · Hadron</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-12">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-white">Public graphs</h1>
    <p class="mt-2 text-zinc-400">Open knowledge graphs available to any organisation.</p>
  </div>

  {#if data.graphs.length === 0}
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500">
      No public graphs yet.
    </div>
  {:else}
    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.graphs as graph (graph.id)}
        <div class="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6 transition hover:border-zinc-600">
          <div>
            <p class="font-mono text-sm font-semibold text-indigo-300">{graph.name}</p>
            <p class="mt-0.5 text-xs text-zinc-500">{graph.organizationId}</p>
          </div>

          <div class="flex flex-wrap gap-2 text-xs">
            {#if graph.source}
              <span class="rounded bg-zinc-800 px-2 py-0.5 text-zinc-400">git-backed</span>
            {:else}
              <span class="rounded bg-zinc-800 px-2 py-0.5 text-zinc-400">DB-only</span>
            {/if}
            {#if graph.readBranch}
              <span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-zinc-400">{graph.readBranch}</span>
            {/if}
          </div>

          {#if graph.lastSyncedAt}
            <p class="text-xs text-zinc-600">
              Last synced {new Date(graph.lastSyncedAt).toLocaleString()}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
