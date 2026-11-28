<script lang="ts">
  // portal#1700: the Nodes tab, restored on BOUNDED reads. The layout still
  // drains nothing; this component reads one page per user action through the
  // two same-origin doors (nodes/children, nodes/page). MemoryBrowser is not
  // used: it takes a fully loaded node array and keeps local search/sort/
  // select-all/export/move state that would read as whole-memory results over a
  // partial page. Those controls are not offered here; the Table's own column
  // sort and paging apply to the rows loaded so far, and say so.
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import NodeList from './NodeList.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import ViewToggle from '$lib/components/ViewToggle.svelte';
  import { t } from '$lib/i18n/t';
  import { NO_CRITERIA, appendUnique, hasCriteria, readTablePage, readTreePage, type TableCriteria } from '$lib/nodes-tab-client';
  import type { MemoryNode } from '$lib/types';

  let { memoryId }: { memoryId: string } = $props();

  type Status = 'idle' | 'loading' | 'failed' | 'done';
  interface Folder {
    rows: MemoryNode[];
    /** Rows the server has handed out so far: the next page's offset (dedupe can make rows.length smaller). */
    consumed: number;
    hasMore: boolean;
    status: Status;
    expanded: boolean;
  }

  // The top level's key. Not a loc: a node can have the empty loc, and `childrenOf: ""` means
  // the top level, so that node has no children of its own to open and must not alias this folder.
  const TOP = '\u0000top';
  const PANE_KEY = 'hadron:memoryBrowser:nodesPane';
  const ROW_HEIGHT_FINE = 32;
  // A coarse pointer needs 44px hit areas, so the windowed rows grow with it (set on mount).
  const ROW_HEIGHT_COARSE = 44;
  const OVERSCAN = 10;
  const FALLBACK_VIEWPORT = 448;

  let pane = $state<'tree' | 'table'>('table');
  let rowHeight = $state(ROW_HEIGHT_FINE);
  // One controller for everything in flight; destroy (a memory switch re-keys this component) aborts it.
  const controller = new AbortController();
  let alive = true;
  // portal#2693: the Table's own controller, replaced when the search changes so an answer to an
  // older search is aborted, and (guarded again by identity below) never applied.
  let tableCtl = new AbortController();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => {
    alive = false;
    controller.abort();
    tableCtl.abort();
    clearTimeout(searchTimer);
  });

  // ── Tree ─────────────────────────────────────────────────────────────
  // A Map, not a record: a loc is user data, and a node named 'constructor' must not read the prototype.
  const folders = new SvelteMap<string, Folder>();

  async function loadFolder(loc: string) {
    const parent = loc === TOP ? '' : loc;
    let f = folders.get(loc);
    if (!f) {
      const fresh = $state<Folder>({ rows: [], consumed: 0, hasMore: false, status: 'idle', expanded: loc === TOP });
      folders.set(loc, fresh);
      f = fresh;
    }
    // A second expansion or click while a page is in flight must not append it twice.
    if (f.status === 'loading') return;
    f.status = 'loading';
    const offset = f.consumed;
    const page = await readTreePage(memoryId, parent, offset, controller.signal);
    if (!alive) return;
    if (!page) {
      f.status = 'failed';
      return;
    }
    // A response for a page already consumed (a late duplicate) changes nothing.
    if (f.consumed !== offset) return;
    f.rows = appendUnique(f.rows, page.rows);
    f.consumed = offset + page.rows.length;
    f.hasMore = page.hasMore;
    f.status = 'done';
  }

  function toggle(loc: string) {
    const f = folders.get(loc);
    if (f?.expanded) {
      f.expanded = false;
      return;
    }
    if (!f) {
      void loadFolder(loc);
      const created = folders.get(loc);
      if (created) created.expanded = true;
      return;
    }
    f.expanded = true;
    if (f.status === 'idle') void loadFolder(loc);
  }

  type FlatRow =
    | { kind: 'node'; node: MemoryNode; depth: number; open: boolean }
    | { kind: 'status'; status: 'loading' | 'failed' | 'empty' | 'more'; loc: string; depth: number };

  const flatRows = $derived.by(() => {
    const out: FlatRow[] = [];
    const walk = (loc: string, depth: number) => {
      const f = folders.get(loc);
      if (!f) return;
      for (const node of f.rows) {
        const open = node.loc !== '' && folders.get(node.loc)?.expanded === true;
        out.push({ kind: 'node', node, depth, open });
        if (open) walk(node.loc, depth + 1);
      }
      if (f.status === 'loading') out.push({ kind: 'status', status: 'loading', loc, depth });
      else if (f.status === 'failed') out.push({ kind: 'status', status: 'failed', loc, depth });
      else if (f.status === 'done' && f.rows.length === 0) out.push({ kind: 'status', status: 'empty', loc, depth });
      else if (f.status === 'done' && f.hasMore) out.push({ kind: 'status', status: 'more', loc, depth });
    };
    walk(TOP, 0);
    return out;
  });

  // One persistent region announces the folders that are still loading, one entry per folder, so a second
  // folder that starts while the first is pending is a new addition and is announced. The per-row line is
  // plain text, because a virtualised row is re-keyed when its status changes and cannot hold a live region.
  const loadingFolders = $derived(flatRows.flatMap((r) => (r.kind === 'status' && r.status === 'loading' ? [r.loc] : [])));

  // Bounded window: only the rows in (and just around) the scroller's viewport are mounted.
  let scrollTop = $state(0);
  // The scroller is a fixed max-h-[28rem] (448px), so the fallback is exact until it scrolls.
  let viewport = $state(FALLBACK_VIEWPORT);
  // scrollTop is clamped to the content: rows shrink (a folder collapses) before a scroll event arrives.
  const top = $derived(Math.min(scrollTop, Math.max(0, flatRows.length * rowHeight - viewport)));
  const first = $derived(Math.max(0, Math.floor(top / rowHeight) - OVERSCAN));
  const last = $derived(Math.min(flatRows.length, Math.ceil((top + viewport) / rowHeight) + OVERSCAN));
  const windowed = $derived(flatRows.slice(first, last));

  const nodeHref = (n: MemoryNode) => `/app/memories/${n.memoryId}/nodes/${n.id}`;

  // ── Table ────────────────────────────────────────────────────────────
  let tableRows = $state<MemoryNode[]>([]);
  let tableConsumed = 0;
  let tableHasMore = $state(false);
  let tableStatus = $state<Status>('idle');

  // portal#2693: content search, filters and sort are run by the SERVER over the whole memory (the
  // nodes/page door); none is ever a filter over the rows loaded so far. `typed` is the search box,
  // `criteria` what the list currently answers (NO_CRITERIA = the plain paged list).
  const SEARCH_MAX = 200;
  const TAG_MAX = 100;
  const FILTER_MAX = 20;
  const SEARCH_DEBOUNCE_MS = 300;
  const TYPE_CHOICES = ['info', 'reference', 'prompt', 'data', 'chat', 'abstract'];
  let typed = $state('');
  let tagDraft = $state('');
  let criteria = $state<TableCriteria>(NO_CRITERIA);
  const narrowed = $derived(hasCriteria(criteria));

  function setCriteria(patch: Partial<TableCriteria>) {
    const next = { ...criteria, ...patch };
    // Relevance only means something for a text search.
    if (next.sort === 'relevance' && next.q === '') next.sort = '';
    if (JSON.stringify(next) === JSON.stringify(criteria)) return;
    criteria = next;
    tableCtl.abort();
    tableCtl = new AbortController();
    tableRows = [];
    tableConsumed = 0;
    tableHasMore = false;
    tableStatus = 'idle';
    void loadTablePage();
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setCriteria({ q: typed.trim() }), SEARCH_DEBOUNCE_MS);
  }

  function toggleType(type: string) {
    setCriteria({ types: criteria.types.includes(type) ? criteria.types.filter((x) => x !== type) : [...criteria.types, type] });
  }

  function addTag() {
    const tag = tagDraft.trim();
    tagDraft = '';
    if (tag === '' || criteria.tags.includes(tag) || criteria.tags.length >= FILTER_MAX) return;
    setCriteria({ tags: [...criteria.tags, tag] });
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    typed = '';
    tagDraft = '';
    setCriteria(NO_CRITERIA);
  }

  async function loadTablePage() {
    if (tableStatus === 'loading') return;
    tableStatus = 'loading';
    const offset = tableConsumed;
    const ctl = tableCtl;
    const page = await readTablePage(memoryId, offset, ctl.signal, criteria);
    // A newer search replaced this one while it was in flight: its answer is not ours to show.
    if (!alive || ctl !== tableCtl) return;
    if (!page) {
      tableStatus = 'failed';
      return;
    }
    if (tableConsumed !== offset) return;
    tableRows = appendUnique(tableRows, page.rows);
    tableConsumed = offset + page.rows.length;
    tableHasMore = page.hasMore;
    tableStatus = 'done';
  }

  // The Table's rows: an empty name or the empty loc still gets a label (the Tree's "(root node)").
  const tableView = $derived(
    tableRows.map((n) => (n.name ? n : { ...n, name: n.loc === '' ? t('nodes-tab.root-node', '(root node)') : n.loc })),
  );

  function show(next: 'tree' | 'table') {
    pane = next;
    try {
      window.localStorage.setItem(PANE_KEY, next);
    } catch {
      /* a convenience only */
    }
    ensureLoaded();
  }

  function ensureLoaded() {
    if (pane === 'table' && tableStatus === 'idle') void loadTablePage();
    if (pane === 'tree' && !folders.has(TOP)) void loadFolder(TOP);
  }

  onMount(() => {
    try {
      if (window.localStorage.getItem(PANE_KEY) === 'tree') pane = 'tree';
    } catch {
      /* default stays */
    }
    try {
      if (window.matchMedia?.('(pointer: coarse)').matches) rowHeight = ROW_HEIGHT_COARSE;
    } catch {
      /* fine pointer */
    }
    ensureLoaded();
  });
</script>

<section class="space-y-3" data-testid="lazy-nodes-browser" aria-label={t('nodes-tab.label', 'Nodes')}>
  <ViewToggle
    label={t('nodes-tab.view', 'Nodes view')}
    class="ml-auto"
    options={[
      { id: 'table', label: t('nodes-tab.table', 'Table') },
      { id: 'tree', label: t('nodes-tab.tree', 'Tree') },
    ]}
    value={pane}
    onselect={show}
  />
  <p class="text-xs text-zinc-500" data-testid="nodes-scope">
    {t('nodes-tab.scope', 'Listing live nodes. System nodes and comments are not listed here. Pages load as you ask; the list can skip or repeat a row if the memory changes while you browse.')}
  </p>

  {#if pane === 'tree'}
    <p class="text-xs text-zinc-500" data-testid="tree-limit">
      {t('nodes-tab.tree-limit', 'The tree shows branches that have a node of their own, and may leave out a branch that has none. The Table lists every node.')}
      <button type="button" class="text-indigo-500 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2" onclick={() => show('table')}>{t('nodes-tab.open-table', 'Open the Table')}</button>
    </p>
    <LiveRegion class="sr-only" data-testid="tree-loading">{#each loadingFolders as loc (loc)}<span class="block">{loc === TOP ? t('nodes-tab.loading', 'Loading…') : t('nodes-tab.loading-folder', 'Loading {loc}…', { loc })}</span>{/each}</LiveRegion>
    <div
      class="max-h-[28rem] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
      data-testid="tree-scroller"
      onscroll={(e) => { scrollTop = e.currentTarget.scrollTop; viewport = e.currentTarget.clientHeight || FALLBACK_VIEWPORT; }}
    >
      <ul data-testid="tree-list" aria-label={t('nodes-tab.tree', 'Tree')} style:height="{flatRows.length * rowHeight}px" style:padding-top="{first * rowHeight}px" style:box-sizing="border-box">
        {#each windowed as row (row.kind === 'node' ? row.node.id : `${row.status}:${row.loc}`)}
          <li style:height="{rowHeight}px" style:padding-left="{row.depth * 16 + 8}px" class="flex items-center gap-2 text-sm">
            {#if row.kind === 'node'}
              {#if row.node.loc === ''}
                <span class="w-5 shrink-0"></span>
              {:else}
              <button
                type="button"
                class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-zinc-500 pointer-coarse:h-11 pointer-coarse:w-11"
                aria-expanded={row.open}
                aria-label={row.open ? t('nodes-tab.collapse', 'Collapse') : t('nodes-tab.expand', 'Expand')}
                onclick={() => toggle(row.node.loc)}
              >{row.open ? '▾' : '▸'}</button>
              {/if}
              <a data-testid="tree-node" href={nodeHref(row.node)} class="min-w-0 truncate text-zinc-900 hover:underline dark:text-white" title={row.node.loc}>
                {row.node.name || row.node.loc || t('nodes-tab.root-node', '(root node)')}
              </a>
              <span class="min-w-0 truncate text-xs text-zinc-500">{row.node.loc === '' ? t('nodes-tab.root-node', '(root node)') : row.node.loc}</span>
              {#if row.node.memoryId !== memoryId}
                <span class="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t('nodes-tab.inherited', 'inherited')}</span>
              {/if}
            {:else if row.status === 'loading'}
              <span class="text-xs text-zinc-500">{t('nodes-tab.loading', 'Loading…')}</span>
            {:else if row.status === 'failed'}
              <span class="text-xs text-red-500" role="alert">{t('nodes-tab.failed', 'Could not load this page.')}</span>
              <button type="button" class="text-xs text-indigo-500 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2" onclick={() => loadFolder(row.loc)}>{t('nodes-tab.retry', 'Retry')}</button>
            {:else if row.status === 'empty'}
              <span class="text-xs text-zinc-500">{row.loc === TOP ? t('nodes-tab.none', 'No matching or visible nodes.') : t('nodes-tab.no-children', 'No child nodes.')}</span>
            {:else}
              <button type="button" class="text-xs text-indigo-500 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2" onclick={() => loadFolder(row.loc)}>{t('nodes-tab.more-nodes', 'Load more nodes')}</button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <input
        type="search"
        data-testid="nodes-search"
        class="min-w-[10rem] max-w-sm flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        placeholder={t('nodes-tab.search-placeholder', 'Search this memory')}
        aria-label={t('nodes-tab.search-label', 'Search the content of every node in this memory')}
        maxlength={SEARCH_MAX}
        bind:value={typed}
        oninput={onSearchInput}
      />
      {#if typed !== '' || narrowed}
        <button type="button" data-testid="nodes-search-clear" class="rounded-md px-2 py-1.5 text-sm text-indigo-500 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-3" onclick={clearSearch}>{t('nodes-tab.search-clear', 'Clear')}</button>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2" data-testid="nodes-filters">
      <div role="group" aria-label={t('nodes-tab.filter-types', 'Node type')} class="flex flex-wrap gap-1">
        {#each TYPE_CHOICES as type (type)}
          <button
            type="button"
            data-testid={`nodes-type-${type}`}
            aria-pressed={criteria.types.includes(type)}
            class="rounded-full border px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3 {criteria.types.includes(type) ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400'}"
            onclick={() => toggleType(type)}
          >{type}</button>
        {/each}
      </div>
      <label class="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 pointer-coarse:min-h-11">
        <input type="checkbox" data-testid="nodes-mine" checked={criteria.mine} onchange={(e) => setCriteria({ mine: e.currentTarget.checked })} />
        {t('nodes-tab.filter-mine', 'My nodes')}
      </label>
      <select
        data-testid="nodes-changed"
        aria-label={t('nodes-tab.filter-changed', 'Changed')}
        class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 pointer-coarse:min-h-11"
        value={criteria.changed}
        onchange={(e) => setCriteria({ changed: e.currentTarget.value as TableCriteria['changed'] })}
      >
        <option value="">{t('nodes-tab.changed-any', 'Changed any time')}</option>
        <option value="24h">{t('nodes-tab.changed-24h', 'Changed in the last 24 hours')}</option>
        <option value="7d">{t('nodes-tab.changed-7d', 'Changed in the last 7 days')}</option>
        <option value="30d">{t('nodes-tab.changed-30d', 'Changed in the last 30 days')}</option>
      </select>
      <select
        data-testid="nodes-sort"
        aria-label={t('nodes-tab.sort', 'Sort')}
        class="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 pointer-coarse:min-h-11"
        value={criteria.sort}
        onchange={(e) => setCriteria({ sort: e.currentTarget.value as TableCriteria['sort'] })}
      >
        <option value="">{t('nodes-tab.sort-default', 'Default order')}</option>
        <option value="loc">{t('nodes-tab.sort-loc', 'By location')}</option>
        <option value="updated">{t('nodes-tab.sort-updated', 'Recently changed')}</option>
        <option value="relevance" disabled={criteria.q === ''}>{t('nodes-tab.sort-relevance', 'Best match')}</option>
      </select>
    </div>
    <div class="flex flex-wrap items-center gap-2" data-testid="nodes-tags">
      <input
        type="text"
        data-testid="nodes-tag-input"
        class="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white pointer-coarse:min-h-11"
        placeholder={t('nodes-tab.tag-placeholder', 'Filter by tag')}
        aria-label={t('nodes-tab.tag-label', 'Filter by a tag')}
        maxlength={TAG_MAX}
        bind:value={tagDraft}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
      />
      <button type="button" data-testid="nodes-tag-add" class="rounded-md px-2 py-1 text-xs text-indigo-500 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-3" disabled={tagDraft.trim() === ''} onclick={addTag}>{t('nodes-tab.tag-add', 'Add')}</button>
      {#each criteria.tags as tag (tag)}
        <span class="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" data-testid="nodes-tag-chip">
          {tag}
          <button type="button" aria-label={t('nodes-tab.tag-remove', 'Remove tag {tag}', { tag })} class="text-zinc-500 hover:text-zinc-900 dark:hover:text-white pointer-coarse:min-h-11 pointer-coarse:px-2" onclick={() => setCriteria({ tags: criteria.tags.filter((x) => x !== tag) })}>×</button>
        </span>
      {/each}
    </div>
    <LiveRegion data-testid="nodes-tab-none">
      {#if tableStatus === 'done' && tableRows.length === 0}
        <p class="text-sm text-zinc-500">{!narrowed ? t('nodes-tab.none', 'No matching or visible nodes.') : criteria.q !== '' ? t('nodes-tab.search-none', 'No nodes match “{q}” anywhere in this memory.', { q: criteria.q }) : t('nodes-tab.filter-none', 'No nodes in this memory match these filters.')}</p>
      {/if}
    </LiveRegion>
    <p class="text-xs text-zinc-500" data-testid="table-partial">
      {#if narrowed && tableStatus === 'done' && tableRows.length > 0}
        {#if criteria.q !== ''}
          {tableHasMore ? t('nodes-tab.search-more', 'Searched the whole memory for “{q}”; more matches are available.', { q: criteria.q }) : t('nodes-tab.search-all', 'Searched the whole memory for “{q}”; these are all the matches.', { q: criteria.q })}
        {:else}
          {tableHasMore ? t('nodes-tab.filter-more', 'Filtered the whole memory; more matches are available.') : t('nodes-tab.filter-all', 'Filtered the whole memory; these are all the matches.')}
        {/if}
      {:else if tableStatus === 'done' && !tableHasMore}
        {t('nodes-tab.table-end', 'End of the list.')}
      {:else}
        {t('nodes-tab.table-partial', 'Sorting and paging below apply to the rows loaded so far, not the whole memory.')}
      {/if}
      {#if tableRows.length > 0}{t('nodes-tab.loaded-count', '{n} loaded', { n: tableRows.length })}{/if}
    </p>
    {#if tableRows.length > 0}
      {#key criteria}<NodeList nodes={tableView} hideSearch viewMemoryId={memoryId} />{/key}
    {/if}
    <LiveRegion>{#if tableStatus === 'loading'}<p class="text-sm text-zinc-500">{t('nodes-tab.loading', 'Loading…')}</p>{/if}</LiveRegion>
    {#if tableStatus === 'loading'}
      <!-- announced by the LiveRegion above -->
    {:else if tableStatus === 'failed'}
      <p class="text-sm text-red-500" role="alert">
        {t('nodes-tab.failed', 'Could not load this page.')}
        <button type="button" class="text-indigo-500 hover:underline" onclick={() => { tableStatus = 'idle'; void loadTablePage(); }}>{t('nodes-tab.retry', 'Retry')}</button>
      </p>
    {:else if tableStatus === 'done' && tableHasMore}
      <button type="button" class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm pointer-coarse:min-h-11 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" onclick={loadTablePage}>{t('nodes-tab.more-nodes', 'Load more nodes')}</button>
    {/if}
  {/if}
</section>
