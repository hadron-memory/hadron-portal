<script lang="ts">
  // Search-driven user picker for "Add existing user" (#414). Unlike
  // SelectMemory (which filters a preloaded list), this exposes NO users until
  // the operator types a query and clicks Find — the results come from the
  // server (/api/users/search), which returns only a handle, optional github
  // username, avatar, and a *masked* email. We never display a name or a raw
  // email here; that's a deliberate privacy stance (minimise what a bad actor
  // can enumerate). The exact server match semantics (email-exact + handle
  // substring) are being tightened separately — see hadron-server#384.

  import Urn from '$lib/components/Urn.svelte';
  import { type SearchUser, type SearchUserPage, userLabel } from '$lib/users/search-user';

  export type { SearchUser };

  let {
    search,
    placeholder = 'Search by full email or handle…',
    onselect,
    open = $bindable(false),
  }: {
    search: (query: string) => Promise<SearchUserPage>;
    placeholder?: string;
    onselect: (user: SearchUser) => void;
    open?: boolean;
  } = $props();

  let query = $state('');
  let results = $state<SearchUser[]>([]);
  let truncated = $state(false);
  let loading = $state(false);
  let searched = $state(false);
  let error = $state<string | null>(null);

  // Focus the search box when the modal opens. The input is (re)created each
  // time {#if open} renders, so this fires on every open.
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }

  // Avatar fallback: first two letters/digits of the best identifier. Strip
  // non-alphanumerics first so a masked email ("j•••@x.com") yields "J", not "J•".
  function initials(u: SearchUser): string {
    const source = u.handle || u.githubUsername || u.emailMasked || '';
    const alnum = source.replace(/[^a-zA-Z0-9]/g, '');
    return (alnum.slice(0, 2) || '?').toUpperCase();
  }

  // Require 3+ chars before searching — shorter queries match too broadly.
  const MIN_QUERY = 3;
  const canSearch = $derived(query.trim().length >= MIN_QUERY);

  // Monotonic token: a search only writes state if it's still the latest one.
  // Guards against a slow in-flight search resolving after the modal was closed
  // (or closed + reopened) and repopulating results without a fresh Find.
  let searchSeq = 0;

  async function runSearch() {
    const q = query.trim();
    if (q.length < MIN_QUERY || loading) return;
    const seq = ++searchSeq;
    loading = true;
    error = null;
    try {
      const r = await search(q);
      if (seq !== searchSeq) return; // superseded by a newer search or a reset
      results = r.users;
      truncated = r.truncated;
      searched = true;
    } catch {
      if (seq !== searchSeq) return;
      error = 'Search failed. Please try again.';
      results = [];
      truncated = false;
      searched = true;
    } finally {
      if (seq === searchSeq) loading = false;
    }
  }

  function close() {
    open = false;
  }

  function select(user: SearchUser) {
    onselect(user);
    close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') close();
  }

  // Reset search state whenever the modal is closed — including a close driven
  // externally by the parent (navigation, parent state reset), which close()
  // alone wouldn't catch — so the next open always starts blank. Bumping
  // searchSeq invalidates any in-flight search. Safe from the freeze that hit
  // the old table-based picker: this resets plain $state, not TanStack row data
  // (#414), so it can't re-enter autoResetPageIndex.
  $effect(() => {
    if (open) return;
    searchSeq++;
    query = '';
    results = [];
    truncated = false;
    searched = false;
    error = null;
    loading = false;
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onclick={() => close()}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Find a user"
      tabindex="-1"
      class="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col"
      onclick={(e) => e.stopPropagation()}
      style="max-height: 70vh;"
    >
      <!-- Header: search + Find. Submitting (Enter or the button) runs the search. -->
      <form
        class="flex gap-2 border-b border-zinc-200 p-4 dark:border-zinc-700"
        onsubmit={(e) => { e.preventDefault(); runSearch(); }}
      >
        <input
          type="text"
          bind:value={query}
          {placeholder}
          aria-label={placeholder}
          use:focusOnMount
          class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
        <button
          type="submit"
          disabled={!canSearch || loading}
          class="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >{loading ? 'Finding…' : 'Find'}</button>
      </form>

      <!-- Body -->
      <div class="flex-1 overflow-auto p-2">
        {#if loading}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">Searching…</div>
        {:else if error}
          <div class="px-4 py-8 text-center text-sm text-red-500">{error}</div>
        {:else if !searched}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">
            Enter a full email address or a handle (at least 3 characters), then click Find.
          </div>
        {:else if results.length === 0}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">No matching users found.</div>
        {:else}
          <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
            {#each results as user (user.id)}
              <li class="flex items-center gap-3 px-2 py-2">
                {#if user.avatarUrl}
                  <img src={user.avatarUrl} alt="" class="h-8 w-8 shrink-0 rounded-full" />
                {:else}
                  <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{initials(user)}</span>
                {/if}
                <div class="min-w-0 flex-1">
                  {#if user.urn}
                    <Urn value={user.urn} type="user" size={10} />
                  {:else}
                    <span class="truncate text-sm font-medium text-zinc-900 dark:text-white">{userLabel(user)}</span>
                  {/if}
                </div>
                <button
                  type="button"
                  onclick={() => select(user)}
                  class="shrink-0 rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                >Select</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <div>{searched && !loading ? `${results.length} result${results.length !== 1 ? 's' : ''}${truncated ? ' shown; more match. Narrow your search.' : ''}` : ''}</div>
        <div>Esc to close</div>
      </div>
    </div>
  </div>
{/if}
