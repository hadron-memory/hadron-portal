<script lang="ts">
  import { untrack } from 'svelte';
  import { pickerStrings } from '$lib/i18n/picker-strings';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import SelectMemory from './SelectMemory.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
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
    memoriesFailed = false,
    open = $bindable(false),
    onselect,
  }: {
    memories: Array<{ id: string; name: string; urn: string; visibility?: string | null; orgName?: string }>;
    /** The caller's memories stream REJECTED (#1585): the memory stage says so
     * instead of posing as an empty readable set. The mount stays degraded —
     * the picker still opens and closes normally. */
    memoriesFailed?: boolean;
    open?: boolean;
    onselect: (node: NodeChoice) => void;
  } = $props();

  let memory = $state<{ id: string; name: string; urn: string } | null>(null);
  let memoryPickerOpen = $state(false);
  // #1590: the stacked memory picker keeps clear of this row (title and Close).
  let headerEl = $state<HTMLElement | null>(null);

  // Per-instance (#1587 BLIND P3): two node pickers can be open at once —
  // exactly the stacking this component builds for — and a literal hint id
  // would make both search inputs describe themselves by the FIRST
  // instance's hint (a duplicate id, aria-describedby resolving across
  // instances). `$props.id()` (#1591 item 1) is unique per instance AND the
  // same on the server and in hydration, which `Math.random()` was not.
  const uid = $props.id();
  const hintId = `node-picker-search-hint-${uid}`;
  let items = $state<NodeChoice[]>([]);
  let offset = $state(0);
  let hasMore = $state(false);
  let capped = $state(false);
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
    items = []; offset = 0; hasMore = false; capped = false;
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
      // The endpoint owns the ceiling (#1585): a capped page means the list
      // was truncated by the bound, not that everything was shown.
      capped = result.value.capped === true;
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
      // #1588 LOCAL delta P2: with the memories read failed there is nothing
      // to pick and the failure copy IS the stage — auto-opening SelectMemory
      // here mounted a second dialog over the message, showing its own
      // 'No memories found.' until one Escape dismissed it. A picker that
      // knows the list failed may not open a dialog it also knows is unusable.
      memoryPickerOpen = visible && !memoriesFailed;
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
  let dialogEl: HTMLElement | null = null;
  function trapDialog(el: HTMLElement) {
    dialogEl = el;
    trap = focusTrap(el);
    return {
      destroy() { trap?.destroy(); trap = null; dialogEl = null; },
    };
  }
  $effect.pre(() => {
    if (memoryPickerOpen) trap?.suspend();
  });
  $effect(() => {
    if (!memoryPickerOpen) trap?.resume();
  });

  // A state swap that unmounts the focused control — Try again succeeding,
  // Load more vanishing on the last page — drops focus to <body>, and
  // element REMOVAL fires no focusin, so the trap's guard cannot see it
  // (#1582 BLIND delta P2: the next Escape then skipped this dialog and
  // reached the host's earlier-registered window listener). Pull focus back
  // in after every such swap: the search box when the stage has one, the
  // dialog itself otherwise (tabindex -1 keeps it a legal target, and a
  // keydown targeted here reaches the dialog-level handler below).
  // preventScroll (#1584 carried (a)): on the last page Load more vanishes
  // under the user's focus, and a bare focus() would scroll the list back to
  // the search box — the viewport stays where the user left it.
  $effect(() => {
    void failed; void pending; void hasMore; void items.length;
    if (!open || memoryPickerOpen) return;
    if (document.activeElement !== document.body) return;
    (dialogEl?.querySelector('input') ?? dialogEl)?.focus({ preventScroll: true });
  });

  // The window fallback for a focus that never entered this dialog at all
  // (the shared capture-phase helper, #1584): while the NESTED memory picker
  // is open, the key is not ours to take — passed as a condition, not baked
  // in, so the helper knows nothing about this component's nesting.
  const escapeFallback = {
    close: () => { open = false; },
    suppressed: () => memoryPickerOpen,
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[8vh]">
    <div role="dialog" aria-modal="true" aria-label={t('app.nodes.picker.choose', 'Choose a node')} tabindex="-1" use:trapDialog use:dialogEscapeFallback={escapeFallback}
      onkeydown={(event) => {
        // Escape is consumed HERE, at the dialog layer (#1582 BLIND P2-7):
        // layers above (the edit panel's own window listener registers first,
        // so they cannot be stopped from below) must not close with us. The
        // shared consumption also carries the #1584 guards — an Escape that
        // someone consumed, or one cancelling an IME composition in the
        // search box, is not ours. A keydown that never enters the dialog
        // (focus stranded on <body>) is the fallback action's job.
        consumeEscapeAtDialog(event, escapeFallback);
      }}
      class="max-h-[84vh] w-full max-w-3xl space-y-3 overflow-auto rounded-xl border border-zinc-300 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      <div class="flex justify-between gap-3" bind:this={headerEl}>
        <h2 class="font-semibold">{t('app.nodes.picker.choose', 'Choose a node')}</h2>
        <button type="button" onclick={() => open = false}>{t('app.nodes.picker.close', 'Close')}</button>
      </div>

      {#if memory}
        <p class="text-sm">
          {t('app.nodes.picker.in-memory', 'In')} <span class="font-medium">{memory.name}</span>
          <button type="button" class="ml-2 rounded border px-2 py-0.5 text-xs" onclick={() => { memoryPickerOpen = true; }} aria-haspopup="dialog" aria-expanded={memoryPickerOpen}>{t('app.nodes.picker.change-memory', 'Change…')}</button>
        </p>
        <div class="flex flex-wrap gap-2">
          <div class="min-w-0 grow">
            <label class="block text-sm">{t('app.nodes.picker.search-label', 'Search nodes')}
              <!-- No aria-label of its own (#1582 BLIND delta P3, and
                   hrn:node:hadronmemory.com:hadron-portal:review:visible-label-is-the-accessible-name):
                   the visible wrapping label IS the accessible name — an
                   aria-label would override it and voice-control users saying
                   "Search nodes" would miss. The name-or-loc hint lives
                   OUTSIDE the label and rides in via aria-describedby
                   (#1584 carried (c)): inside the label it would widen the
                   accessible name again. maxlength mirrors the endpoint's
                   query ceiling (500) so Enter cannot submit a query the
                   server must 400. -->
              <input bind:value={query} maxlength="500" aria-describedby={hintId} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); find(); } }} class="block w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600" />
            </label>
            <p id={hintId} class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.nodes.picker.search-hint', 'Matches by name or loc.')}</p>
          </div>
          <button type="button" disabled={pending || !memory} onclick={() => find()} class="self-end rounded border px-3 py-1 disabled:opacity-50">{t('app.nodes.picker.find', 'Find')}</button>
        </div>

        {#if failed}
          <p role="alert">{t('app.nodes.picker.failed', 'Couldn’t load nodes. Try again.')}</p>
          <!-- Retry re-reads the FAILED page (`read` pages the committed query
               at the offset that never advanced); it must not restart the
               search and throw away the rows already loaded (#1582 BLIND P3). -->
          <button type="button" disabled={pending} class="rounded border px-3 py-1 disabled:opacity-50" onclick={() => read()}>{t('app.nodes.picker.retry', 'Try again')}</button>
        {/if}
        <LiveRegion>{#if pending}<p>{t('app.nodes.picker.loading', 'Loading nodes…')}</p>{/if}</LiveRegion>

        <DataTable {table} listKey="node-picker:open" showSearch={false} searchPlaceholder="" searchAriaLabel="" bounded>
          {#snippet cell(cell, row)}
            <div class="flex min-w-0 items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{row.name}</p>
                <p class="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.loc}</p>
                <div class="mt-1"><Urn value={row.urn} /></div>
              </div>
              <button type="button" class="shrink-0 rounded bg-indigo-600 px-2 py-1 text-white pointer-coarse:min-h-11" aria-label={pickerStrings.selectNamed(row.name)} onclick={() => { onselect(row); open = false; }}>{pickerStrings.select()}</button>
            </div>
          {/snippet}
        </DataTable>

        {#if hasMore}
          <button type="button" disabled={pending} class="rounded border px-3 py-1 disabled:opacity-50" onclick={() => read()}>{t('app.nodes.picker.more', 'Load more nodes')}</button>
        {:else if capped}
          <!-- Not "all shown": the offset ceiling truncated the list (#1585).
               hasMore is already false, so there is no Load more to press into
               the 400 — this note is the honest replacement for it. -->
          <p role="status">{t('app.nodes.picker.capped', 'Showing the first results only. Search to narrow the list.')}</p>
        {/if}
        <LiveRegion data-testid="node-picker-empty">
          {#if !pending && !failed && searched && items.length === 0}<p>{t('app.nodes.picker.empty', 'No nodes found.')}</p>{/if}
        </LiveRegion>
      {:else if memoriesFailed}
        <p role="alert">{t('app.nodes.picker.memories-failed', 'Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.')}</p>
      {:else}
        <p class="text-sm text-zinc-600 dark:text-zinc-300">{t('app.nodes.picker.pick-memory', 'Pick which memory to search in first.')}</p>
        <button type="button" class="rounded border px-3 py-1" onclick={() => { memoryPickerOpen = true; }} aria-haspopup="dialog" aria-expanded={memoryPickerOpen}>{t('app.nodes.picker.choose-memory', 'Choose a memory…')}</button>
      {/if}
    </div>
  </div>
{/if}

<!-- A memory chosen here voids the whole stage-2 list (#1582 LOCAL P2): the
     reset is `resetStage2`, so `pending` cannot strand when a read for the
     PREVIOUS memory is still in flight — its `finally` skips the cleanup for
     the moved generation, exactly as for a new search. -->
<SelectMemory {memories} clearOf={headerEl} bind:open={memoryPickerOpen} onselect={(chosen) => { memory = chosen; resetStage2(); }} />
