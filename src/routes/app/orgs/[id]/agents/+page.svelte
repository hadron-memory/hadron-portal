<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>Agents · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-start justify-between">
    <div>
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        { label: org.name, href: `/app/orgs/${org.id}` },
        { label: 'Agents' },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Agents</h1>
      <p class="text-sm text-zinc-500">Group memories into agents for station subscriptions.</p>
    </div>
    <a href="/app/orgs/{org.id}/agents/new" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
      New Agent
    </a>
  </div>

  {#if !org.agents?.length}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No agents yet. <a href="/app/orgs/{org.id}/agents/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one →</a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each org.agents as agent (agent.id)}
        <a
          href="/app/orgs/{org.id}/agents/{agent.id}"
          class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{agent.name}</p>
            <p class="font-mono text-xs text-zinc-400">{agent.urn}</p>
            {#if agent.description}
              <p class="mt-1 text-xs text-zinc-500">{agent.description}</p>
            {/if}
          </div>
          <span class="text-xs text-zinc-400">{agent.memoryItems.length} memor{agent.memoryItems.length !== 1 ? 'ies' : 'y'}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-zinc-400"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </a>
      {/each}
    </div>
  {/if}
</div>
