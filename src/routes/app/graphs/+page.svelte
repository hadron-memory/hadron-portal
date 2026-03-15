<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  const filtered = $derived(
    data.graphs.filter((g) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return g.name.toLowerCase().includes(q);
    })
  );
</script>

<svelte:head><title>My Graphs · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">My Graphs</h1>
    <a
      href="/browse"
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
    >
      + Add from marketplace
    </a>
  </div>

  {#if data.graphs.length > 0}
    <div>
      <input
        type="text"
        placeholder="Search your graphs..."
        bind:value={search}
        class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
  {/if}

  {#if data.graphs.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-lg font-medium text-zinc-700 dark:text-zinc-300">No graphs yet</p>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Knowledge graphs give your AI agent instant expertise on any topic.
      </p>
      <a
        href="/browse"
        class="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Browse the marketplace
      </a>
    </div>
  {:else if filtered.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No graphs match "{search}".
    </div>
  {:else}
    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {#each filtered as graph (graph.id)}
        <div class="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
          <div class="space-y-3">
            <p class="font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">{graph.name}</p>

            <div class="flex flex-wrap gap-2 text-xs">
              <span
                class="rounded px-2 py-0.5
                  {graph.syncStatus === 'OK'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : graph.syncStatus === 'ERROR'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
              >
                {graph.syncStatus === 'OK' ? 'Synced' : graph.syncStatus.toLowerCase()}
              </span>
              {#if graph.source}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">git-backed</span>
              {:else}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">DB-only</span>
              {/if}
              {#if graph.visibility === 'PUBLIC'}
                <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">public</span>
              {/if}
              {#if graph.lastSyncedAt}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  synced {new Date(graph.lastSyncedAt).toLocaleDateString()}
                </span>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
