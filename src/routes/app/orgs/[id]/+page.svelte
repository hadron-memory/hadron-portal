<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>{org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/orgs" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Organizations</a>
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{org.name}</h1>
      <p class="font-mono text-sm text-zinc-500">{org.slug}</p>
    </div>
  </div>

  <!-- Members preview -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Members <span class="ml-1 text-sm font-normal text-zinc-500">({org.members?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/members" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each (org.members ?? []).slice(0, 8) as m (m.id)}
        <div class="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {#if m.user.avatarUrl}
            <img src={m.user.avatarUrl} alt={m.user.login} class="h-5 w-5 rounded-full" />
          {/if}
          <span class="text-zinc-700 dark:text-zinc-300">{m.user.name ?? m.user.login}</span>
          <span class="text-xs text-zinc-500">{m.role}</span>
        </div>
      {/each}
    </div>
  </section>

  <!-- Graphs -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Graphs <span class="ml-1 text-sm font-normal text-zinc-500">({org.graphs?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/graphs" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    {#if !org.graphs?.length}
      <p class="text-sm text-zinc-500">No graphs yet.</p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.graphs as g (g.id)}
          <a href="/app/orgs/{org.id}/graphs/{g.id}" class="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <div class="flex items-center justify-between">
              <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{g.name}</p>
              <span class="rounded px-1.5 py-0.5 text-xs {g.visibility === 'PUBLIC' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{g.visibility}</span>
            </div>
            {#if g.lastSyncedAt}
              <p class="mt-1 text-xs text-zinc-500">Synced {new Date(g.lastSyncedAt).toLocaleDateString()}</p>
            {/if}
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Subscriptions -->
  {#if org.subscriptions?.length}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Subscribed graphs <span class="ml-1 text-sm font-normal text-zinc-500">({org.subscriptions.length})</span></h2>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.subscriptions as s (s.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="font-mono text-sm text-indigo-600 dark:text-indigo-300">{s.graph.name}</p>
            <p class="mt-1 text-xs text-zinc-500">Role: {s.role}</p>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
