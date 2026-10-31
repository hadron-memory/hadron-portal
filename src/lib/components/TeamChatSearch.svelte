<!--
  #1013 — search a team chat's HISTORY (server#2299 / #2882).

  The server owns matching, paging and the read gate; this panel only asks and
  renders. Three things it must not blur:
    - empty + complete is "no matches"; empty + incomplete is "scan limit
      reached, continue" — never the same message;
    - a typed refusal (encrypted, not found, cursor invalid) is never an empty
      result list;
    - a response for a query the reader has since replaced, or that lands after
      teardown, is discarded.
  Results page independently from the live thread and never mark a range read.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { teamChatSearchStrings as s } from '$lib/i18n/team-chat-search-strings';
  import {
    isSearchableQuery,
    isSearchResponse,
    outcomeOf,
    type TeamChatSearchHit,
    type TeamChatSearchRefusal,
    type TeamChatSearchResponse,
  } from '$lib/team-chat-search';

  let { appId }: { appId: string } = $props();

  let input = $state('');
  let tooShort = $state(false);
  // The query the CURRENT results belong to (the input may have moved on).
  let activeQuery = $state<string | null>(null);
  let rows = $state<TeamChatSearchHit[]>([]);
  let complete = $state(false);
  let cursor = $state<string | null>(null);
  let busy = $state(false);
  // A refusal of the first page replaces the results; one on a later page keeps them.
  let refusal = $state<TeamChatSearchRefusal | null>(null);
  let laterRefusal = $state<TeamChatSearchRefusal | null>(null);

  // Every request takes a ticket; only the newest ticket may write state.
  let ticket = 0;
  let destroyed = false;
  let inputEl: HTMLInputElement | undefined = $state();
  onMount(() => inputEl?.focus());
  let controller: AbortController | null = null;
  onDestroy(() => {
    destroyed = true;
    controller?.abort();
  });

  async function fetchPage(query: string, from: string | null, mine: number): Promise<TeamChatSearchResponse | null> {
    controller?.abort();
    controller = new AbortController();
    const params = new URLSearchParams({ q: query });
    if (from) params.set('cursor', from);
    try {
      const res = await fetch(`/app/apps/${encodeURIComponent(appId)}/team-chat/search?${params}`, { signal: controller.signal });
      const body = res.ok ? await res.json() : null;
      return mine === ticket && !destroyed ? (isSearchResponse(body) ? body : { ok: false, code: 'FAILED' }) : null;
    } catch {
      return mine === ticket && !destroyed ? { ok: false, code: 'FAILED' } : null;
    }
  }

  async function search(event?: Event, retryOf: string | null = null) {
    event?.preventDefault();
    const query = retryOf ?? input;
    tooShort = !isSearchableQuery(query);
    if (tooShort) return;
    const mine = ++ticket;
    busy = true;
    refusal = laterRefusal = null;
    activeQuery = query;
    rows = [];
    table.setPageIndex(0);
    cursor = null;
    complete = false;
    const res = await fetchPage(query, null, mine);
    if (!res) return; // stale or torn down: someone else owns `busy` now
    busy = false;
    if (!res.ok) {
      refusal = res.code;
      return;
    }
    rows = res.items;
    complete = res.complete;
    cursor = res.cursor;
  }

  async function more() {
    if (activeQuery === null || !cursor || busy) return;
    const mine = ++ticket;
    busy = true;
    laterRefusal = null;
    const res = await fetchPage(activeQuery, cursor, mine);
    if (!res) return;
    busy = false;
    if (!res.ok) {
      laterRefusal = res.code;
      return;
    }
    const firstNew = rows.length;
    rows = [...rows, ...res.items];
    // One visible pager: land on the page holding the first new row.
    table.setPageIndex(Math.floor(firstNew / table.atoms.pagination.get().pageSize));
    complete = res.complete;
    cursor = res.cursor;
  }

  // The same cursor can never succeed again: recovery is a fresh search.
  const cursorDead = $derived(laterRefusal === 'TEAM_CHAT_SEARCH_CURSOR_INVALID');
  const outcome = $derived(
    activeQuery !== null && refusal === null && !busy ? outcomeOf(rows, complete, cursor) : null,
  );

  const PAGE_SIZE = 100;
  const columns: PortalColumnDef<TeamChatSearchHit>[] = [
    { id: 'when', accessorFn: (r) => r.at ?? '', header: s.colWhen(), size: 150, enableSorting: false },
    { id: 'author', accessorFn: (r) => r.authorName ?? '', header: s.colAuthor(), size: 110, enableSorting: false },
    { id: 'urn', accessorFn: (r) => r.urn ?? '', header: s.colUrn(), size: 240, enableSorting: false },
    { id: 'message', accessorFn: (r) => r.body ?? '', header: s.colMessage(), enableHiding: false, size: 360, enableSorting: false },
  ];
  const table = createSvelteTable<TeamChatSearchHit>({
    get data() { return rows; },
    columns,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    manualFiltering: true,
    enableGlobalFilter: false,
    autoResetPageIndex: false,
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    getRowId: (r) => r.nodeId,
  });
</script>

<section class="flex min-h-0 flex-col gap-3 p-3" aria-label={s.heading()} data-testid="team-chat-search">
  <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{s.heading()}</h3>
  <p class="text-xs text-zinc-500 dark:text-zinc-400">{s.scope()}</p>
  <form class="flex flex-wrap items-start gap-2" onsubmit={search}>
    <label class="sr-only" for="team-chat-search-input">{s.label()}</label>
    <input
      id="team-chat-search-input"
      type="search"
      bind:value={input}
      bind:this={inputEl}
      placeholder={s.placeholder()}
      aria-invalid={tooShort}
      aria-describedby={tooShort ? 'team-chat-search-short' : undefined}
      class="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
    <button type="submit" disabled={busy} class="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
      {s.submit()}
    </button>
  </form>
  {#if tooShort}
    <p id="team-chat-search-short" role="alert" class="text-xs text-red-600 dark:text-red-400">{s.tooShort()}</p>
  {/if}

  <div aria-live="polite" class="text-sm">
    {#if busy && rows.length === 0}
      <p class="text-zinc-500 dark:text-zinc-400" data-testid="team-chat-search-pending">{s.searching()}</p>
    {:else if refusal}
      <p class="text-red-600 dark:text-red-400" data-testid="team-chat-search-refusal">{s.refusal(refusal)}</p>
      {#if refusal === 'FAILED'}
        <button type="button" class="mt-1 text-indigo-600 underline dark:text-indigo-300" onclick={() => search(undefined, activeQuery)}>{s.retry()}</button>
      {/if}
    {:else if outcome === 'no-matches'}
      <p class="text-zinc-600 dark:text-zinc-300" data-testid="team-chat-search-none">{s.noMatches(activeQuery ?? '')}</p>
    {:else if outcome === 'scan-limit'}
      <p class="text-amber-700 dark:text-amber-300" data-testid="team-chat-search-scan-limit">{s.scanLimit()}</p>
    {/if}
  </div>

  {#if rows.length > 0}
    <DataTable {table} listKey="app-team-chat-search" searchPlaceholder="" searchAriaLabel="" showSearch={false} maxHeight="max(200px, calc(100vh - 28rem))">
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'message'}
          {#if row.body !== null}
            <span class="whitespace-pre-wrap break-words">{row.body}</span>
          {:else}
            <span class="italic text-zinc-500 dark:text-zinc-400">{s.unavailable()}</span>
          {/if}
        {:else if cell.column.id === 'urn'}
          {#if row.urn}
            <Urn value={row.urn} type="node" linked compact />
          {:else}
            <span class="text-xs text-zinc-500 dark:text-zinc-400">{s.noLink()}</span>
          {/if}
        {:else if cell.column.id === 'when'}
          {row.at ? new Date(row.at).toLocaleString() : ''}
        {:else}
          {cell.getValue() ?? ''}
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  {#if laterRefusal}
    <p aria-live="polite" class="text-xs text-red-600 dark:text-red-400" data-testid="team-chat-search-later-failed">
      {s.laterFailed()} {s.refusal(laterRefusal)}
    </p>
  {/if}
  {#if cursor && !complete && !refusal && activeQuery !== null}
    <div class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
      {#if rows.length > 0 && !laterRefusal}<span>{s.incomplete()}</span>{/if}
      <button type="button" disabled={busy} onclick={cursorDead ? () => search(undefined, activeQuery) : more} class="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800" data-testid="team-chat-search-more">
        {cursorDead ? s.searchAgain() : laterRefusal ? s.retry() : rows.length === 0 ? s.continueSearch() : s.loadMore()}
      </button>
    </div>
  {/if}
</section>
