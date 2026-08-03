<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  const filtered = $derived(
    data.memories.filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q);
    })
  );
</script>

<svelte:head>
  <title>Memories · Hadron</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-12">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white">Memories</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">Find AI knowledge memories for any purpose.</p>
  </div>

  <div class="mb-6">
    <input
      type="text"
      placeholder="Search memories..."
      bind:value={search}
      class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
    />
  </div>

  {#if filtered.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      {search ? 'No memories match your search.' : 'No public memories yet.'}
    </div>
  {:else}
    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {#each filtered as memory (memory.id)}
        <div class="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
          <div class="space-y-3">
            <div>
              <p class="font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">{memory.name}</p>
              <p class="font-mono text-xs text-zinc-400">{memory.urn}</p>
            </div>

            <div class="flex flex-wrap gap-2 text-xs">
              {#if memory.source}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">git-backed</span>
              {:else}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">DB-only</span>
              {/if}
              {#if memory.lastSyncedAt}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  synced {new Date(memory.lastSyncedAt).toLocaleDateString()}
                </span>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
