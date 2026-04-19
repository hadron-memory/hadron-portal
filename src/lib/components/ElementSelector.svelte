<script lang="ts">
  type Element = {
    id: string;
    name: string;
    loc: string;
    type: string;
    description?: string | null;
    breadcrumb?: string;
  };

  let {
    elements,
    placeholder = 'Search...',
    typeFilter = null,
    onselect,
    open = $bindable(false),
  }: {
    elements: Element[];
    placeholder?: string;
    typeFilter?: string | null;
    onselect: (el: Element) => void;
    open?: boolean;
  } = $props();

  let query = $state('');

  const filtered = $derived.by(() => {
    let results = elements;
    if (typeFilter) {
      results = results.filter((e) => e.type === typeFilter);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.loc.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q),
      );
    }
    return results.slice(0, 20);
  });

  function select(el: Element) {
    onselect(el);
    open = false;
    query = '';
  }

  function typeBadgeColor(type: string): string {
    if (type === 'topic') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    if (type === 'conversation') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    if (type === 'stage') return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  }
</script>

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
          <div class="px-4 py-6 text-center text-sm text-zinc-500">No matches found.</div>
        {:else}
          {#each filtered as el (el.id)}
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onclick={() => select(el)}
            >
              <span class="rounded px-1.5 py-0.5 text-[10px] font-medium {typeBadgeColor(el.type)}">{el.type}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-zinc-900 dark:text-white">{el.name}</p>
                <p class="truncate text-xs text-zinc-400">{el.loc}</p>
                {#if el.breadcrumb}
                  <p class="truncate text-xs text-zinc-400">{el.breadcrumb}</p>
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
