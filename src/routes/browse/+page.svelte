<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  // #687 — a failed catalogue read is NOT an empty catalogue. Without this the
  // portal's public front door says "No public memories yet" during an outage.
  const loadFailed = $derived(data.loadFailed === true);

  const filtered = $derived(
    data.memories.filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q);
    })
  );
</script>

<svelte:head>
  <title>Memories · Hadron</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-12">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-zinc-900 dark:text-white">Memories</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">Find AI knowledge memories for any purpose.</p>
  </div>

  <div class="mb-6">
    <input
      type="text"
      placeholder="Search memories..."
      bind:value={search}
      class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
    />
  </div>

  {#if loadFailed}
    <!-- #687. Checked BEFORE the empty state, because on failure `memories` is
         also empty and the two would otherwise be indistinguishable. Copy
         mirrors /app/memories: it names the distinction rather than saying
         something went wrong, since "not an empty catalogue" is the part a
         reader cannot infer.

         Through t() even though this page's surrounding chrome is literal
         (@codex and @copilot on #772). "Don't piecemeal-localize" governs
         CONVERTING existing copy; a NEW user-visible string goes through the
         boundary regardless — `$lib/i18n/t.ts` is explicit that they do so
         "from this commit on". Leaving it out would make it permanently
         untranslatable to save touching nothing. -->
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-12 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('browse.load-failed', "Couldn't load the public memories just now — this is a temporary error, not an empty catalogue. Try refreshing the page.")}
    </div>
  {:else if filtered.length === 0}
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
        </div>
      {/each}
    </div>
  {/if}
</div>
