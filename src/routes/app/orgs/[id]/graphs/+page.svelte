<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>Graphs · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <a href="/app/orgs/{org.id}" class="text-sm text-zinc-400 hover:text-white">← {org.name}</a>
      <h1 class="mt-1 text-2xl font-bold text-white">Graphs</h1>
    </div>
    <a href="/app/orgs/{org.id}/graphs/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
      + Add graph
    </a>
  </div>

  {#if !org.graphs?.length}
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500">
      No graphs yet. <a href="/app/orgs/{org.id}/graphs/new" class="text-indigo-400 hover:underline">Add one →</a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each org.graphs as g (g.id)}
        <div class="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <a href="/app/orgs/{org.id}/graphs/{g.id}" class="font-mono text-sm font-semibold text-indigo-300 hover:underline">{g.name}</a>
              <span class="rounded px-1.5 py-0.5 text-xs {g.visibility === 'PUBLIC' ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}">{g.visibility}</span>
            </div>
            <div class="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
              {#if g.source}<span>📦 git-backed</span>{:else}<span>🗄️ DB-only</span>{/if}
              {#if g.readBranch}<span>branch: {g.readBranch}</span>{/if}
              {#if g.lastSyncedAt}<span>synced {new Date(g.lastSyncedAt).toLocaleDateString()}</span>{/if}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <a href="/app/orgs/{org.id}/graphs/{g.id}" class="text-sm text-zinc-400 hover:text-white">Edit</a>
            <form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm(`Delete "${g.name}"?`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={g.id} />
              <button type="submit" class="text-sm text-red-400 hover:text-red-300">Delete</button>
            </form>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
