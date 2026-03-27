<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

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
  <title>Browse Marketplace · Hadron</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Browse Marketplace</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">Find AI knowledge memories for any purpose. Grab one to give your AI agent instant expertise.</p>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <div>
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

          <form method="POST" action="?/addToMyMemories" use:enhance>
            <input type="hidden" name="memoryId" value={memory.id} />
            <button type="submit" class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Use this memory
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
