<script lang="ts">
  import { untrack } from 'svelte';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import SelectMemory from './SelectMemory.svelte';
  import Urn from './Urn.svelte';
  import type { NodeChoice, NodeChoicesPage } from '$lib/node-choices';

  /**
   * portal#1576 — a node picker in the Select* family. Stage 1 reuses
   * SelectMemory over the caller's readable set; stage 2 searches the chosen
   * memory's nodes server-side (name and loc, the viewer's own token) and
   * pages by short pages — a lexical findNodes has no usable total
   * (hadron-server#3113), so the server says where the next page starts
   * (`nextOffset`, raw-count based) and whether one exists (`hasMore`).
   * onselect receives the node's SERVER-supplied URN, never one built on the
   * client.
   */
  let {
    memories,
    open = $bindable(false),
    onselect,
  }: {
    memories: Array<{ id: string; name: string; urn: string; visibility?: string | null; orgName?: string }>;
    open?: boolean;
    onselect: (node: NodeChoice) => void;
  } = $props();

  let memory = $state<{ id: string; name: string; urn: string } | null>(null);
  let memoryPickerOpen = $state(false);
  let items = $state<NodeChoice[]>([]);
  let offset = $state(0);
  let hasMore = $state(false);
  let pending = $state(false);
  let failed = $state(false);
  let searched = $state(false);
  let query = $state('');
  // The query that PRODUCED the list (#1582 LOCAL/BLIND P2): Load more and
  // retry page it, never the live input text, which the user may have edited
  // without pressing Find.
  let committedQuery = $state('');
  let generation = 0;

  // One identity column with the Select button in the same cell
  // (hrn:node:hadronmemory.com:hadron-portal:findings:fixed-picker-columns-hide-select-on-phones, the SelectApp #1200
  // pattern): fixed name/loc/urn/choose columns total 730px and put the
  // primary action beyond a 390px phone viewport — the table scrolls
  // internally, so a page-overflow check passes while Select is unusable.
  const columns: PortalColumnDef<NodeChoice>[] = [
    { id: 'node', accessorFn: (row) => `${row.name} ${row.loc} ${row.urn}`, header: t('app.nodes.picker.col.node', 'Node'), enableHiding: false, enableSorting: false, size: 300, minSize: 200 },
  ];
  // Stable row identity (hrn:node:hadronmemory.com:hadron-portal:findings:select-modal-autoreset-data-identity-freeze):
  // `items` is only ever reassigned, never re-derived per read.
  const table = createSvelteTable<NodeChoice>({
    get data() { return items; },
    columns,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  // One reset for every "the list is void now" moment — a new search, a new
  // memory, a reopen — so no path can forget a field. `pending` is reset
  // here deliberately (#1582 LOCAL P2): the generation bump below discards
  // any in-flight read, and its `finally` will SKIP `pending = false` for
  // exactly that reason — without this reset the picker stranded dead until
  // it was closed and reopened.
  function resetStage2() {
    generation++;
    items = []; offset = 0; hasMore = false;
    pending = false; failed = false; searched = false; committedQuery = '';
  }

  async function read() {
    if (!memory || pending) return;
    const current = generation;
    const targetMemory = memory.id;
    const pageQuery = committedQuery;
    const pageOffset = offset;
    pending = true; failed = false;
    try {
      const response = await fetch(`/app/memories/${encodeURIComponent(targetMemory)}/nodes/choices?query=${encodeURIComponent(pageQuery)}&offset=${pageOffset}`);
      if (!response.ok) throw new Error('unavailable');
      const result: { kind: 'ok'; value: NodeChoicesPage } | { kind: 'failed' } = await response.json();
      if (current !== generation) return;
      // The server URN is the contract; anything without one is unusable. The
      // endpoint drops such rows itself — this is the belt to its braces, and
      // the two predicates agree (#1582 BLIND P2-3: they used to disagree,
      // turning a whole page into a permanent failure over one bad row).
      if (result.kind !== 'ok' || !Array.isArray(result.value.items) || !Number.isSafeInteger(result.value.nextOffset) || result.value.items.some((node) => typeof node.urn !== 'string' || !node.urn)) throw new Error('unavailable');
      // Keyword pages over one memory are ordered score DESC then loc, but the
      // list can change under us: append without duplicates, like SelectTask.
      const seen = new Set(items.map((node) => node.id));
      const fresh = result.value.items.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id); return true;
      });
      items = [...items, ...fresh];
      // Page by the SERVER's raw-count window, never by the filtered rows we
      // received: a page that lost rows (or was all duplicates) still consumed
      // a full raw window, and only the server knows how far that window
      // reached. `hasMore` is likewise its call alone.
      offset = result.value.nextOffset;
      hasMore = result.value.hasMore;
      searched = true;
    } catch {
      if (current === generation) failed = true;
    } finally {
      if (current === generation) pending = false;
    }
  }

  function find() {
    if (!memory || pending) return;
    resetStage2();
    // The one field a fresh search owns: the query that will produce the list.
    committedQuery = query.trim();
    void read();
  }

  $effect(() => {
    const visible = open;
    untrack(() => {
      generation++;
      memory = null;
      resetStage2();
      query = '';
      memoryPickerOpen = visible;
    });
    return () => { generation++; };
  });

  // The dialog's focus trap, held by the component so it can stand down while
  // the NESTED memory picker is on top (#1582 QA P2): SelectMemory's dialog is
  // a DOM sibling with its own document-level focusin guard, and two live
  // guards re-trigger each other until the stack overflows. `pre` suspends
  // BEFORE the upper dialog mounts; resume happens after it unmounts (and its
  // own trap has restored focus back into this dialog).
  let trap: ReturnType<typeof focusTrap> | null = null;
  function trapDialog(el: HTMLElement) {
    trap = focusTrap(el);
    return {
      destroy() { trap?.destroy(); trap = null; },
    };
  }
  $effect.pre(() => {
    if (memoryPickerOpen) trap?.suspend();
  });
  $effect(() => {
    if (!memoryPickerOpen) trap?.resume();
  });
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[8vh]">
    <div role="dialog" aria-modal="true" aria-label={t('app.nodes.picker.choose', 'Choose a node')} tabindex="-1" use:trapDialog
      onkeydown={(event) => {
        // Escape is consumed HERE, at the dialog layer (#1582 BLIND P2-7):
        // layers above (the edit panel's own window listener registers first,
        // so they cannot be stopped from below) must not close with us. While
        // the nested memory picker is open the key is not ours to take.
        if (event.key === 'Escape' && !memoryPickerOpen) {
          event.stopPropagation();
          open = false;
        }
      }}
      class="max-h-[84vh] w-full max-w-3xl space-y-3 overflow-auto rounded-xl border border-zinc-300 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      <div class="flex justify-between gap-3">
        <h2 class="font-semibold">{t('app.nodes.picker.choose', 'Choose a node')}</h2>
        <button type="button" onclick={() => open = false}>{t('app.nodes.picker.close', 'Close')}</button>
      </div>

      {#if memory}
        <p class="text-sm">
          {t('app.nodes.picker.in-memory', 'In')} <span class="font-medium">{memory.name}</span>
          <button type="button" class="ml-2 rounded border px-2 py-0.5 text-xs" onclick={() => { memoryPickerOpen = true; }}>{t('app.nodes.picker.change-memory', 'Change…')}</button>
        </p>
        <div class="flex flex-wrap gap-2">
          <label class="min-w-0 grow text-sm">{t('app.nodes.picker.search-label', 'Search nodes')}
            <input aria-label={t('app.nodes.picker.search', 'Search nodes by name or loc…')} bind:value={query} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); find(); } }} class="block w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600" />
          </label>
          <button type="button" disabled={pending || !memory} onclick={() => find()} class="self-end rounded border px-3 py-1 disabled:opacity-50">{t('app.nodes.picker.find', 'Find')}</button>
        </div>

        {#if failed}
          <p role="alert">{t('app.nodes.picker.failed', 'Couldn’t load nodes. Try again.')}</p>
          <!-- Retry re-reads the FAILED page (`read` pages the committed query
               at the offset that never advanced); it must not restart the
               search and throw away the rows already loaded (#1582 BLIND P3). -->
          <button type="button" disabled={pending} onclick={() => read()}>{t('app.nodes.picker.retry', 'Try again')}</button>
        {/if}
        {#if pending}<p role="status">{t('app.nodes.picker.loading', 'Loading nodes…')}</p>{/if}

        <DataTable {table} listKey="node-picker:open" showSearch={false} searchPlaceholder="" searchAriaLabel="" maxHeight="35vh">
          {#snippet cell(cell, row)}
            <div class="flex min-w-0 items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{row.name}</p>
                <p class="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.loc}</p>
                <div class="mt-1"><Urn value={row.urn} /></div>
              </div>
              <button type="button" class="shrink-0 rounded bg-indigo-600 px-2 py-1 text-white" onclick={() => { onselect(row); open = false; }}>{t('app.nodes.picker.select', 'Select')}</button>
            </div>
          {/snippet}
        </DataTable>

        {#if hasMore}
          <button type="button" disabled={pending} class="rounded border px-3 py-1 disabled:opacity-50" onclick={() => read()}>{t('app.nodes.picker.more', 'Load more nodes')}</button>
        {/if}
        {#if !pending && !failed && searched && items.length === 0}
          <p role="status">{t('app.nodes.picker.empty', 'No nodes found.')}</p>
        {/if}
      {:else}
        <p class="text-sm text-zinc-600 dark:text-zinc-300">{t('app.nodes.picker.pick-memory', 'Pick which memory to search in first.')}</p>
        <button type="button" class="rounded border px-3 py-1" onclick={() => { memoryPickerOpen = true; }}>{t('app.nodes.picker.choose-memory', 'Choose a memory…')}</button>
      {/if}
    </div>
  </div>
{/if}

<!-- A memory chosen here voids the whole stage-2 list (#1582 LOCAL P2): the
     reset is `resetStage2`, so `pending` cannot strand when a read for the
     PREVIOUS memory is still in flight — its `finally` skips the cleanup for
     the moved generation, exactly as for a new search. -->
<SelectMemory {memories} bind:open={memoryPickerOpen} onselect={(chosen) => { memory = chosen; resetStage2(); }} />
