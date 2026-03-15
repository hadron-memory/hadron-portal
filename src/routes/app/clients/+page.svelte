<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const typeIcon: Record<string, string> = {
    WORKSTATION: '💻', CLOUD: '☁️', IOT: '📡', AGENT: '🤖',
  };
</script>

<svelte:head><title>Clients · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Clients</h1>
    <a href="/app/clients/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">+ New client</a>
  </div>

  {#if data.clients.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No clients yet. <a href="/app/clients/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one →</a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each data.clients as client (client.id)}
        <a href="/app/clients/{client.id}" class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
          <span class="text-2xl">{typeIcon[client.clientType] ?? '🔑'}</span>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-zinc-900 dark:text-white">{client.label}</p>
            <p class="text-xs text-zinc-500">{client.clientType}{client.user ? ` · ${client.user.name ?? client.user.githubUsername}` : ''}</p>
          </div>
          <div class="text-right text-xs text-zinc-500">
            <p>{client.bundleSubscriptions?.length ?? 0} bundle sub{client.bundleSubscriptions?.length === 1 ? '' : 's'}</p>
            {#if client.expiresAt}
              <p class="text-yellow-600">expires {new Date(client.expiresAt).toLocaleDateString()}</p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
