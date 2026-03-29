<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  const filtered = $derived(
    data.memories.filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) ||
        (m.urn ?? '').toLowerCase().includes(q) ||
        (m.shortDescription ?? '').toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q));
    })
  );
</script>

<svelte:head><title>My Memories · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">My Memories</h1>
    <a
      href="/browse"
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
    >
      + Add from marketplace
    </a>
  </div>

  {#if data.memories.length > 0}
    <div>
      <input
        type="text"
        placeholder="Search your memories..."
        bind:value={search}
        class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
  {/if}

  {#if data.memories.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-lg font-medium text-zinc-700 dark:text-zinc-300">No memories yet</p>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Knowledge memories give your AI agent instant expertise on any topic.
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
      No memories match "{search}".
    </div>
  {:else}
    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {#each filtered as memory (memory.id)}
        <div class="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
          <div class="space-y-2">
            <a href="/app/orgs/{memory.organizationId}/memories/{memory.id}/browse" class="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{memory.name}</a>
            <div class="flex items-center gap-1">
              <p class="font-mono text-xs text-zinc-400">{memory.urn}</p>
              <button onclick={() => navigator.clipboard.writeText(memory.urn)} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>

            {#if memory.shortDescription}
              <p class="text-xs text-zinc-600 dark:text-zinc-400">{memory.shortDescription}</p>
            {/if}

            {#if memory.tags.length > 0}
              <div class="flex flex-wrap gap-1">
                {#each memory.tags as tag}
                  <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
                {/each}
              </div>
            {/if}

            <div class="flex flex-wrap gap-2 text-xs">
              <span
                class="rounded px-2 py-0.5
                  {memory.syncStatus === 'OK'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : memory.syncStatus === 'ERROR'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
              >
                {memory.syncStatus === 'OK' ? 'Synced' : memory.syncStatus.toLowerCase()}
              </span>
              {#if memory.source}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">git-backed</span>
              {:else}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">DB-only</span>
              {/if}
              {#if memory.visibility === 'PUBLIC'}
                <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">public</span>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
