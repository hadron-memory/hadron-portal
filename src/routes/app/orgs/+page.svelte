<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Organizations · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">Organizations</h1>
    <a href="/app/orgs/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
      + New organization
    </a>
  </div>

  {#if data.orgs.length === 0}
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
      <p class="text-zinc-400">You're not a member of any organization yet.</p>
      <a href="/app/orgs/new" class="mt-4 inline-block text-sm text-indigo-400 hover:underline">Create your first organization →</a>
    </div>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2">
      {#each data.orgs as org (org.id)}
        <a href="/app/orgs/{org.id}" class="rounded-xl border border-zinc-800 bg-zinc-900 p-6 transition hover:border-zinc-600">
          <p class="text-lg font-semibold text-white">{org.name}</p>
          <p class="font-mono text-xs text-zinc-500">{org.slug}</p>
          <div class="mt-4 flex gap-6 text-sm text-zinc-400">
            <span>{org.members?.length ?? 0} member{org.members?.length === 1 ? '' : 's'}</span>
            <span>{org.graphs?.length ?? 0} graph{org.graphs?.length === 1 ? '' : 's'}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
