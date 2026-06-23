<script lang="ts">
  interface Memory {
    id: string;
    name: string;
    urn: string;
    visibility?: string | null;
    orgName?: string;
  }

  let {
    memories,
    placeholder = 'Search memories by name or URN...',
    onselect,
    open = $bindable(false),
  }: {
    memories: Memory[];
    placeholder?: string;
    onselect: (memory: Memory) => void;
    open?: boolean;
  } = $props();

  let query = $state('');

  const filtered = $derived.by(() => {
    if (!Array.isArray(memories)) return [];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return memories.filter(
        (m) =>
          m?.name?.toLowerCase().includes(q) ||
          m?.urn?.toLowerCase().includes(q),
      );
    }
    return memories;
  });

  function select(memory: Memory) {
    onselect(memory);
    open = false;
    query = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      open = false;
    }
  }

  $effect(() => {
    if (!open) {
      query = '';
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onclick={() => { open = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="border-b border-zinc-200 p-3 dark:border-zinc-700">
        <input
          type="text"
          bind:value={query}
          {placeholder}
          autofocus
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
      </div>
      <div class="max-h-64 overflow-y-auto">
        {#if filtered.length === 0}
          <div class="px-4 py-6 text-center text-sm text-zinc-500">No memories found.</div>
        {:else}
          {#each filtered as memory (memory.id)}
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onclick={() => select(memory)}
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-zinc-900 dark:text-white">{memory.name}</p>
                <p class="truncate text-xs text-zinc-400">{memory.urn}</p>
                {#if memory.orgName}
                  <p class="truncate text-xs text-zinc-400">{memory.orgName}</p>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
      <div class="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-700">
        {filtered.length} result{filtered.length !== 1 ? 's' : ''} · Esc to close
      </div>
    </div>
  </div>
{/if}
