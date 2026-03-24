<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const memoryCount = $derived(data.memories.length);
</script>

<svelte:head><title>Dashboard · Hadron</title></svelte:head>

<div class="space-y-8">
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>

  <!-- Quick stats -->
  <div class="grid gap-4 sm:grid-cols-3">
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">Memories</p>
      <p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{memoryCount}</p>
    </div>
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">Stations</p>
      <p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{data.stations.length}</p>
    </div>
    {#if !data.isConsumerMode}
      <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">Organizations</p>
        <p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{data.orgs.filter(o => o.isVisible !== null).length}</p>
      </div>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">Status</p>
        <p class="mt-1 text-sm font-medium text-green-600 dark:text-green-400">
          {memoryCount > 0 ? 'Ready' : 'Getting started'}
        </p>
      </div>
    {/if}
  </div>

  <!-- My Memories preview -->
  <section>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">My Memories</h2>
      <div class="flex gap-2">
        <a href="/browse" class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Browse marketplace
        </a>
        <a href="/app/my-memories" class="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          View all →
        </a>
      </div>
    </div>
    {#if data.memories.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-zinc-500 dark:text-zinc-400">You haven't added any memories yet.</p>
        <p class="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
          <a href="/browse" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Browse the marketplace</a> to find knowledge memories for your AI agent.
        </p>
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.memories.slice(0, 6) as memory (memory.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <p class="font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">{memory.name}</p>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {memory.syncStatus === 'OK' ? 'Synced' : memory.syncStatus.toLowerCase()}
              </span>
              {#if memory.source}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">git-backed</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if data.memories.length > 6}
        <p class="mt-3 text-sm text-zinc-500">
          <a href="/app/my-memories" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">View all {data.memories.length} memories →</a>
        </p>
      {/if}
    {/if}
  </section>

  <!-- Organizations (only for users with explicit orgs) -->
  {#if !data.isConsumerMode}
    <section>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">Organizations</h2>
        <a href="/app/orgs/new" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          + New org
        </a>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        {#each data.orgs.filter(o => o.isVisible !== null) as org (org.id)}
          <a href="/app/orgs/{org.id}" class="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <p class="font-semibold text-zinc-900 dark:text-white">{org.name}</p>
            <p class="mt-0.5 font-mono text-xs text-zinc-500">{org.domain}</p>
            <div class="mt-3 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{org.members?.length ?? 0} member{org.members?.length === 1 ? '' : 's'}</span>
              <span>{org.memories?.length ?? 0} memor{org.memories?.length === 1 ? 'y' : 'ies'}</span>
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/if}
</div>
