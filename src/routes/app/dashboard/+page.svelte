<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Dashboard · Hadron</title></svelte:head>

<div class="space-y-8">
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>

  <!-- Orgs summary -->
  <section>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">My organizations</h2>
      <a href="/app/orgs/new" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
        + New org
      </a>
    </div>
    {#if data.orgs.length === 0}
      <p class="text-sm text-zinc-500">No organizations yet. <a href="/app/orgs/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one</a>.</p>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2">
        {#each data.orgs as org (org.id)}
          <a href="/app/orgs/{org.id}" class="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <p class="font-semibold text-zinc-900 dark:text-white">{org.name}</p>
            <p class="mt-0.5 font-mono text-xs text-zinc-500">{org.slug}</p>
            <div class="mt-3 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{org.members?.length ?? 0} member{org.members?.length === 1 ? '' : 's'}</span>
              <span>{org.graphs?.length ?? 0} graph{org.graphs?.length === 1 ? '' : 's'}</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Clients summary -->
  <section>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">My clients</h2>
      <a href="/app/clients/new" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
        + New client
      </a>
    </div>
    {#if data.clients.length === 0}
      <p class="text-sm text-zinc-500">No clients yet. <a href="/app/clients/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one</a>.</p>
    {:else}
      <div class="grid gap-4 sm:grid-cols-2">
        {#each data.clients as client (client.id)}
          <a href="/app/clients/{client.id}" class="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <p class="font-semibold text-zinc-900 dark:text-white">{client.label}</p>
            <p class="mt-0.5 text-xs text-zinc-500">{client.type}</p>
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{client.graphs?.length ?? 0} graph subscription{client.graphs?.length === 1 ? '' : 's'}</p>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
