<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
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

<svelte:head><title>Memories · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Memories</h1>
    <p class="mt-1 text-sm text-zinc-500">All memories across your organizations.</p>
  </div>

  {#if data.memories.length > 0}
    <div>
      <input
        type="text"
        placeholder="Search memories..."
        bind:value={search}
        class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
  {/if}

  {#if data.memories.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No memories yet. Create one from an organization's Memories page.
    </div>
  {:else if filtered.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No memories match "{search}".
    </div>
  {:else}
    <div class="space-y-3">
      {#each filtered as memory (memory.id)}
        <a
          href="/app/orgs/{memory.organizationId}/memories/{memory.id}/browse"
          class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{memory.name}</p>
            <Urn value={memory.urn} type="memory" size={10} />
            {#if memory.shortDescription}
              <p class="mt-1 text-xs text-zinc-500">{memory.shortDescription}</p>
            {/if}
            <div class="mt-1 flex items-center gap-2 text-xs text-zinc-400">
              <span>{memory.organization?.name ?? ''}</span>
              {#if memory.visibility === 'PUBLIC'}
                <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">public</span>
              {:else if memory.visibility === 'ORGANIZATION'}
                <span class="rounded bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">organization</span>
              {:else}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">private</span>
              {/if}
              {#if memory.source}
                <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">git-backed</span>
              {/if}
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-zinc-400"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </a>
      {/each}
    </div>
  {/if}
</div>
