<script lang="ts">
  import TreeView from './TreeView.svelte';
  import TopicGraph from './TopicGraph.svelte';
  import NodeList from './NodeList.svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { graphState } from './GraphState.svelte';
  import { buildGraphViewData, buildTreeEntries } from '$lib/graph-utils';
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { NODE_FIELD_MASK_OPTIONS } from '$lib/search/node-fields';
  import type { MemoryNode, TreeEntry, SearchHitMeta } from '$lib/types';

  /** Build the URL to a node's detail page, or empty if memory context is missing */
  function nodeHref(node: MemoryNode, base: string): string {
    if (base) return `${base}/nodes/${node.id}`;
    // #260: memory pages are org-less, so the fallback needs only the memory id.
    const memId = node.memory?.id;
    if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
    return '';
  }

  let {
    nodes,
    nodesTotal = null,
    basePath = '',
    multiMemory = false,
    writableMemoryIds = [],
    scopeMemoryIds = [],
    forcedView,
  }: {
    nodes: MemoryNode[];
    /**
     * #429: the memory's full server-reported node count. `nodes` is a capped
     * window (limit 5000), so when `nodesTotal` exceeds it the browse/filter
     * view is working over a truncated set. Null/absent (agent + app pages)
     * falls back to the loaded count — no truncation claim.
     */
    nodesTotal?: number | null;
    basePath?: string;
    multiMemory?: boolean;
    writableMemoryIds?: string[];
    /**
     * #433: the page's full memory scope, independent of which nodes loaded.
     * Server search derives its scope from the loaded `nodes` by default, but a
     * memory with zero loaded (non-deleted) rows — e.g. a fully soft-deleted
     * memory the Include-deleted audit view targets — never appears there.
     * Multi-memory pages (agent/app) pass their attached memory ids so those
     * memories stay searchable. Single-memory pages don't need it (the id is
     * recovered from basePath).
     */
    scopeMemoryIds?: string[];
    /** When set (the #266 tab layout), fixes the view and hides the toggle. */
    forcedView?: 'graph' | 'nodes';
  } = $props();

  const writableSet = $derived(new Set(writableMemoryIds));

  // #429: the loaded window is truncated when the server's full count exceeds
  // the rows we actually loaded. Drives the "N of M" count + a notice so the
  // truncation is no longer silent.
  const displayTotal = $derived(nodesTotal ?? nodes.length);
  const isTruncated = $derived(nodesTotal != null && nodes.length < nodesTotal);

  // Saved-views key for the flat node list (spec 020), scoped to the single
  // memory being browsed. Only set when viewing one memory's detail (basePath
  // is `/app/memories/<id>`); absent on the multi-memory global browse page.
  const nodeListKey = $derived(
    basePath && !multiMemory ? `memory:${basePath.split('/').pop()}:nodes` : undefined,
  );

  // ── Sub-view ──────────────────────────────────────────────────────────
  // Persist the graph/nodes view choice in localStorage so that when the
  // user navigates to a node detail page and hits Back, they land on the
  // same view they came from.
  const VIEW_MODE_KEY = 'hadron:memoryBrowser:viewMode';
  function readStoredView(): 'graph' | 'nodes' {
    if (typeof window === 'undefined') return 'graph';
    try {
      const v = window.localStorage.getItem(VIEW_MODE_KEY);
      return v === 'nodes' ? 'nodes' : 'graph';
    } catch {
      return 'graph';
    }
  }
  // forcedView (the #266 tab layout) overrides the persisted toggle choice.
  let storedView = $state<'graph' | 'nodes'>(readStoredView());
  const activeView = $derived(forcedView ?? storedView);
  $effect(() => {
    if (forcedView || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, storedView);
    } catch {
      /* ignore quota / disabled storage */
    }
  });

  // Within the nodes view, the tree and the flat table are two representations
  // of the same node set — showing both side-by-side is redundant. Pick one via
  // a Tree | Table toggle (persisted). The graph view keeps the tree as a
  // navigation sidebar (a different, complementary representation), so this only
  // governs activeView === 'nodes'.
  const NODES_PANE_KEY = 'hadron:memoryBrowser:nodesPane';
  function readStoredPane(): 'tree' | 'table' {
    if (typeof window === 'undefined') return 'table';
    try {
      return window.localStorage.getItem(NODES_PANE_KEY) === 'tree' ? 'tree' : 'table';
    } catch {
      return 'table';
    }
  }
  // Seed a deterministic default for SSR, then hydrate the persisted choice on
  // the client inside an effect — seeding $state directly from localStorage
  // would diverge from the server-rendered 'table' and trip a hydration
  // mismatch. The first effect run reads the stored value (without persisting);
  // later runs persist user changes.
  let nodesPane = $state<'tree' | 'table'>('table');
  let paneHydrated = false;
  $effect(() => {
    if (!paneHydrated) {
      paneHydrated = true;
      const stored = readStoredPane();
      if (stored !== nodesPane) nodesPane = stored;
      return;
    }
    try {
      window.localStorage.setItem(NODES_PANE_KEY, nodesPane);
    } catch {
      /* ignore quota / disabled storage */
    }
  });

  let treeOpen = $state(true);
  let treeWidth = $state(256);
  let dragging = $state(false);

  // Lifted from TreeView so both the tree and the flat node list honor the
  // same "show hidden (record + system) nodes" toggle. The checkbox UI still
  // lives in TreeView but binds against this state via the bindable prop.
  let showHidden = $state(false);

  // When the URL carries ?focus=<nodeId>, we forward it to TopicGraph so
  // the node is selected and centered, and we switch to the graph view.
  const focusId = $derived($page.url.searchParams.get('focus') ?? undefined);
  $effect(() => {
    if (focusId && !forcedView) storedView = 'graph';
  });

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    dragging = true;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMove(ev: MouseEvent) {
      treeWidth = Math.max(150, Math.min(500, startWidth + ev.clientX - startX));
    }
    function onUp() {
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Drag & drop handlers for tree ────────────────────────────────────
  // Fail-loud (#501): a rejected move — most notably NODE_ALREADY_EXISTS
  // when the destination slot is occupied (moves never overwrite) — shows
  // the server's message instead of the tree silently snapping back.
  let moveError = $state<string | null>(null);

  async function handleTreeMove(fromLoc: string, newParentLoc: string) {
    const node = nodes.find((n) => n.loc === fromLoc);
    if (!node) return;
    const name = fromLoc.split(':').pop()!;
    const newLoc = newParentLoc ? `${newParentLoc}:${name}` : name;
    if (fromLoc === newLoc) return;

    moveError = null;
    try {
      // #564: the endpoint takes the node's PK + bare destination loc and
      // composes the full target URN server-side.
      const res = await fetch('/api/nodes/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRef: node.id, toLoc: newLoc }),
      });
      if (res.ok) {
        await invalidateAll();
      } else {
        const data = await res.json().catch(() => ({}));
        moveError = data.error ?? 'Failed to move node';
      }
    } catch (e) {
      moveError = e instanceof Error ? e.message : 'Failed to move node';
    }
  }

  async function handleTreeReorder(parentLoc: string, orderedLocs: string[]) {
    // Determine memoryId from the first sibling
    const firstNode = nodes.find((n) => n.loc === orderedLocs[0]);
    if (!firstNode) return;
    const updates = orderedLocs.map((loc, i) => ({ loc, seq: i + 1 }));

    try {
      const res = await fetch('/api/nodes/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, memoryId: firstNode.memoryId }),
      });
      if (res.ok) await invalidateAll();
    } catch { /* ignore */ }
  }

  // ── Search (issue #355) ────────────────────────────────────────────────
  // ONE search box, server-backed: it searches node CONTENT (+ name +
  // description) across this page's memory set — not just the loaded rows.
  // `keyword` is still mirrored to graphState so TreeView/TopicGraph can
  // highlight matches. `searchMode` is the exact↔fuzzy toggle (the CLI's
  // matchExactly): exact = substring (nodes), fuzzy = semantic (nodeSearch).
  let keyword = $state('');
  let searchMode = $state<'exact' | 'regex' | 'fuzzy'>('exact');
  $effect(() => { graphState.searchFilter = keyword; });
  onDestroy(() => { graphState.searchFilter = ''; });

  // #429: structured server-side dimensions the slim loaded set can't answer
  // client-side. `myNodesOnly` → findNodes filter.createdBy (needs the caller's
  // id); `changedSince` → filter.updatedAfter; `sortMode` → server sort. These,
  // plus a text query, put the browser into "server view" (serverResults is the
  // working set); the memory/type/tag/hidden filters still refine client-side.
  const currentUserId = $derived(
    ($page.data as { user?: { id?: string | null } | null }).user?.id ?? null,
  );
  let myNodesOnly = $state(false);
  let changedSince = $state<'any' | '24h' | '7d' | '30d'>('any');
  // 'loc' is the natural browse order and does NOT force a server fetch;
  // updatedAt/relevance require the server (not in the slim loaded set).
  let sortMode = $state<'loc' | 'updatedAt' | 'relevance'>('loc');
  // #433: include soft-deleted nodes (findNodes filter.includeDeleted) — an
  // audit/restore view; server-only (the slim loaded set excludes deleted).
  let includeDeleted = $state(false);
  // #433: the fields weight-mask (findNodes fields, cor:api:090:03) — scopes a
  // LEXICAL query's scoring to a subset of node fields. Empty = all fields
  // (the server default). Ignored for Fuzzy (vector retrieval) and for a
  // filter-only list (no ranking). Options are shared with the endpoint's
  // validation via $lib/search/node-fields so the two can't drift.
  let searchFields = $state<Set<string>>(new Set());
  const lexicalMode = $derived(searchMode === 'exact' || searchMode === 'regex');

  const changedSinceIso = $derived.by(() => {
    const now = Date.now();
    const days = changedSince === '24h' ? 1 : changedSince === '7d' ? 7 : changedSince === '30d' ? 30 : 0;
    return days ? new Date(now - days * 24 * 60 * 60 * 1000).toISOString() : null;
  });
  const serverFilter = $derived({
    createdBy: myNodesOnly ? currentUserId : null,
    updatedAfter: changedSinceIso,
    updatedBefore: null as string | null,
    includeDeleted: includeDeleted || null,
  });
  // A stable key for the fields mask — a fresh Set identity on every toggle
  // would re-run the search effect even when the selection is unchanged (same
  // guard as searchMemoryIdsStr). Only lexical modes send it.
  const searchFieldsStr = $derived(lexicalMode ? [...searchFields].sort().join(',') : '');
  // In server view, serverResults replaces the loaded set as the working pool.
  const serverViewActive = $derived(
    keyword.trim() !== '' ||
      !!serverFilter.createdBy ||
      !!serverFilter.updatedAfter ||
      !!serverFilter.includeDeleted ||
      sortMode === 'updatedAt' ||
      sortMode === 'relevance',
  );

  // The memory set to search = the distinct memories in the loaded nodes
  // (memory page → one; agent/app → several). Empty ⇒ nothing to search.
  // Derive a STABLE string key, not an array: `nodes` gets a new identity on
  // every reorder/invalidate, and a fresh array reference would re-run the
  // search effect each time even when the id set is unchanged (PR #358 review).
  const searchMemoryIdsStr = $derived.by(() => {
    const ids = new Set(nodes.map((n) => n.memoryId));
    // #433: also include the page's declared scope so a memory with zero loaded
    // (non-deleted) rows stays searchable — the Include-deleted audit/restore
    // view must reach fully soft-deleted memories, which never appear in `nodes`.
    for (const id of scopeMemoryIds) ids.add(id);
    // Single-memory pages carry the memory id in basePath (/app/memories/<id>)
    // even when nothing loaded — recover it so an empty memory is searchable.
    if (!multiMemory && basePath) {
      const id = basePath.split('/').pop();
      if (id) ids.add(id);
    }
    return [...ids].sort().join(',');
  });

  // Server search results: null = not in server view (show the normal browse set).
  let serverResults = $state<MemoryNode[] | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let searchNote = $state<string | null>(null);
  let searchCapped = $state(false); // server hit the result cap — showing a slice
  let searchSnippets = $state<Record<string, string>>({}); // #430 nodeId → matching passage
  let searchMeta = $state<Record<string, SearchHitMeta>>({}); // #432 nodeId → relevance/stale meta
  let searchSeq = 0; // monotonic — drops out-of-order responses

  async function runServerFetch(
    q: string,
    mode: 'exact' | 'regex' | 'fuzzy',
    memoryIds: string[],
    filter: { createdBy: string | null; updatedAfter: string | null; updatedBefore: string | null; includeDeleted: boolean | null },
    sort: 'loc' | 'updatedAt' | 'relevance',
    fields: string[],
    signal?: AbortSignal,
  ) {
    if (memoryIds.length === 0) { serverResults = []; searching = false; return; }
    const seq = ++searchSeq;
    searching = true;
    searchError = null;
    searchNote = null;
    searchCapped = false;
    searchSnippets = {};
    searchMeta = {};
    try {
      const res = await fetch('/api/nodes/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, mode, memoryIds, filter, sort, fields }),
        signal,
      });
      const data = await res.json();
      if (seq !== searchSeq) return; // a newer request superseded this one
      if (!res.ok) { searchError = data.error ?? 'Search failed'; serverResults = []; return; }
      serverResults = data.nodes ?? [];
      searchNote = data.note ?? null;
      searchCapped = !!data.capped;
      searchSnippets = data.snippets ?? {};
      searchMeta = data.meta ?? {};
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // superseded / destroyed
      if (seq !== searchSeq) return;
      searchError = e instanceof Error ? e.message : 'Search failed';
      serverResults = [];
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }

  // Debounce query / filter / sort changes into a server fetch; clear
  // immediately (and cancel any in-flight response) when server view turns off.
  $effect(() => {
    const q = keyword.trim();
    const mode = searchMode;
    const idsStr = searchMemoryIdsStr;
    const filter = serverFilter;
    const sort = sortMode;
    const fieldsStr = searchFieldsStr; // tracked dep; '' when non-lexical
    if (!serverViewActive) {
      searchSeq++;
      serverResults = null;
      searching = false;
      searchError = null;
      searchNote = null;
      searchCapped = false;
      searchSnippets = {};
      searchMeta = {};
      return;
    }
    const ids = idsStr ? idsStr.split(',') : [];
    // #431: validate a regex pattern client-side — the server 400s on invalid
    // patterns (e.g. an unbalanced `(`); show an inline error instead of firing.
    if (mode === 'regex' && q) {
      try {
        new RegExp(q);
      } catch {
        searchSeq++;
        serverResults = [];
        searching = false;
        searchError = 'Invalid regex pattern.';
        searchNote = null;
        searchCapped = false;
        searchSnippets = {};
        searchMeta = {};
        return;
      }
    }
    const fields = fieldsStr ? fieldsStr.split(',') : [];
    const controller = new AbortController();
    const timer = setTimeout(() => runServerFetch(q, mode, ids, filter, sort, fields, controller.signal), 300);
    return () => {
      clearTimeout(timer);
      controller.abort(); // cancel an in-flight fetch on new keystroke / destroy
    };
  });

  // ── Filters ───────────────────────────────────────────────────────────
  const availableMemoryUrns = $derived([...new Set(nodes.map((n) => n.memory?.urn ?? ''))].filter(Boolean).sort());
  const availableNodeTypes = $derived([...new Set(nodes.map((n) => n.nodeType ?? 'info'))].sort());
  const availableTags = $derived([...new Set(nodes.flatMap((n) => n.tags ?? []))].sort());

  let activeMemoryUrns = $state<Set<string>>(new Set());
  let activeNodeTypes = $state<Set<string>>(new Set());
  let activeTags = $state<Set<string>>(new Set());

  // Dropdown open state
  let openDropdown = $state<'memory' | 'type' | 'tags' | 'fields' | null>(null);

  function toggleDropdown(d: 'memory' | 'type' | 'tags' | 'fields') {
    openDropdown = openDropdown === d ? null : d;
  }

  function handleWindowClick(e: MouseEvent) {
    if (openDropdown && !(e.target as Element)?.closest?.('.filter-dropdown')) {
      openDropdown = null;
    }
  }

  const hasActiveFilters = $derived(
    activeMemoryUrns.size > 0 ||
      activeNodeTypes.size > 0 ||
      activeTags.size > 0 ||
      keyword.length > 0 ||
      myNodesOnly ||
      changedSince !== 'any' ||
      includeDeleted ||
      searchFields.size > 0 ||
      sortMode !== 'loc',
  );

  function clearAllFilters() {
    activeMemoryUrns = new Set();
    activeNodeTypes = new Set();
    activeTags = new Set();
    keyword = '';
    myNodesOnly = false;
    changedSince = 'any';
    includeDeleted = false;
    searchFields = new Set();
    sortMode = 'loc';
  }

  function toggleField(f: string) {
    if (searchFields.has(f)) searchFields.delete(f);
    else searchFields.add(f);
    searchFields = new Set(searchFields);
  }

  function toggleMemory(urn: string) {
    if (activeMemoryUrns.has(urn)) activeMemoryUrns.delete(urn);
    else activeMemoryUrns.add(urn);
    activeMemoryUrns = new Set(activeMemoryUrns);
  }

  function toggleNodeType(t: string) {
    if (activeNodeTypes.has(t)) activeNodeTypes.delete(t);
    else activeNodeTypes.add(t);
    activeNodeTypes = new Set(activeNodeTypes);
  }

  function toggleTag(t: string) {
    if (activeTags.has(t)) activeTags.delete(t);
    else activeTags.add(t);
    activeTags = new Set(activeTags);
  }

  // ── Filtered nodes ────────────────────────────────────────────────────
  // Hidden types (record + system) are excluded by both the tree and the
  // node list unless the showHidden toggle is on. filteredNodes keeps the
  // full pool (so TreeView can still detect hasHiddenNodes and render the
  // toggle); the filter is applied in searchedNodes below, which feeds
  // NodeList.
  const HIDDEN_TYPES = new Set(['record', 'system']);
  // When a server search is active, its results ARE the working set; otherwise
  // the loaded nodes. The memory/type/tag dropdowns refine whichever is shown.
  const displayNodes = $derived(serverResults ?? nodes);
  const filteredNodes = $derived(
    displayNodes.filter((n) => {
      if (activeMemoryUrns.size > 0 && !activeMemoryUrns.has(n.memory?.urn ?? '')) return false;
      if (activeNodeTypes.size > 0 && !activeNodeTypes.has(n.nodeType ?? 'info')) return false;
      if (activeTags.size > 0 && !(n.tags ?? []).some((t) => activeTags.has(t))) return false;
      return true;
    })
  );

  // Whether the current (memory/type/tag-filtered) pool still contains
  // record/system nodes — gates the "Show hidden" control in the filter bar
  // for the nodes view. Both nodes panes pass hideSearch to TreeView (which
  // also hides its own Records checkbox), so this filter-bar control is the
  // single toggle. Based on filteredNodes to mirror TreeView's own
  // visibility test, so it disappears when active filters exclude them all.
  const hasHiddenNodes = $derived(filteredNodes.some((n) => HIDDEN_TYPES.has(n.nodeType ?? 'info')));

  const searchedNodes = $derived(
    filteredNodes.filter((n) => {
      // Hide record + system nodes unless the user toggled them on. The text
      // match itself is now done server-side (issue #355), so there's no
      // client-side keyword filter here — `filteredNodes` already reflects
      // either the loaded set or the server search results.
      if (!showHidden && HIDDEN_TYPES.has(n.nodeType ?? 'info')) return false;
      return true;
    })
  );

  // #372: a server search matches across ALL node types, but the hidden-types
  // filter then drops record/system matches — so a query that only hit record
  // nodes shows an empty/short list with no clue the matches exist. The dropped
  // matches are exactly what searchedNodes removed from filteredNodes, so the
  // count is their length difference (naturally 0 once "Show hidden" is on,
  // since searchedNodes === filteredNodes then). Search-scoped via serverResults.
  const hiddenSearchMatchCount = $derived(
    serverResults !== null ? filteredNodes.length - searchedNodes.length : 0
  );

  // ── Tree node href callback (for when basePath is empty) ──────────────
  // Build a map from nodeId → href so TreeView can link nodes without basePath
  const nodeIdToHref = $derived.by(() => {
    if (basePath) return null; // not needed when basePath is set
    const map = new Map<string, string>();
    for (const n of filteredNodes) {
      const href = nodeHref(n, basePath);
      if (href) map.set(n.id, href);
    }
    return map;
  });

  function treeNodeHrefFn(entry: TreeEntry): string | null {
    if (!entry.nodeId || !nodeIdToHref) return null;
    return nodeIdToHref.get(entry.nodeId) ?? null;
  }

  // Graph view: a tree-row click selects the node in the graph (opening its
  // popup) rather than navigating to its detail page, mirroring a click on the
  // node itself (#349). Setting graphState.selectedNodeId is exactly what a
  // graph click does; TopicGraph reacts by focusing the node and showing the
  // popup. Only the graph-view tree gets this — the nodes-view tree navigates.
  function handleTreeSelect(entry: TreeEntry) {
    if (!entry.nodeId) return; // virtual folder — no graph node to select
    graphState.selectedNodeId = entry.nodeId;
  }

  // ── Derived views ─────────────────────────────────────────────────────
  // Derive single memory URN for loc normalization (only when all nodes share one memory)
  const singleMemoryUrn = $derived.by(() => {
    const urns = new Set(filteredNodes.map((n) => n.memory?.urn).filter(Boolean));
    return urns.size === 1 ? [...urns][0] : undefined;
  });
  const rawGraphViewData = $derived(buildGraphViewData(filteredNodes, singleMemoryUrn));
  const treeEntries = $derived(buildTreeEntries(filteredNodes, singleMemoryUrn));

  // Color rules: multiple memories → color by memory; multiple selected types → color by type; otherwise same color
  const graphViewData = $derived.by(() => {
    const gv = rawGraphViewData;
    const memoryUrns = [...new Set(filteredNodes.map((n) => n.memory?.urn ?? ''))].filter(Boolean);
    const hasMultiMemory = multiMemory && memoryUrns.length > 1;
    const hasMultiTypeFilter = activeNodeTypes.size > 1;

    // Walk up loc path to find a parent's domain
    function findParentDomain(id: string, map: Record<string, string>): string {
      const parts = id.split(':');
      for (let i = parts.length - 1; i > 0; i--) {
        const parent = parts.slice(0, i).join(':');
        if (map[parent]) return map[parent];
      }
      return 'all';
    }

    // Build maps keyed by node.id (for topics) and by loc (for folders)
    const idToType: Record<string, string> = {};
    const idToMemory: Record<string, string> = {};
    const idToReadOnly: Record<string, boolean> = {};
    const locToType: Record<string, string> = {};
    const locToMemory: Record<string, string> = {};

    for (const n of filteredNodes) {
      idToType[n.id] = n.nodeType ?? 'info';
      idToMemory[n.id] = n.memory?.name ?? n.memory?.urn ?? '';
      locToType[n.loc] = n.nodeType ?? 'info';
      locToMemory[n.loc] = n.memory?.name ?? n.memory?.urn ?? '';
      if (writableSet.size > 0) {
        idToReadOnly[n.id] = !writableSet.has(n.memoryId);
      }
    }

    // Helper: remap domain on topics (keyed by node.id) and folderNodes (keyed by loc)
    function remapDomains(topicFn: (id: string) => string, folderFn: (loc: string) => string) {
      return {
        ...gv,
        topics: gv.topics.map((t) => ({ ...t, domain: topicFn(t.id), readOnly: idToReadOnly[t.id] ?? false })),
        folderNodes: gv.folderNodes.map((f) => ({ ...f, domain: folderFn(f.id) })),
      };
    }

    if (hasMultiTypeFilter) {
      return remapDomains(
        (id) => idToType[id] ?? 'info',
        (loc) => locToType[loc] ?? findParentDomain(loc, locToType),
      );
    }

    if (hasMultiMemory) {
      return remapDomains(
        (id) => idToMemory[id] ?? '',
        (loc) => locToMemory[loc] ?? findParentDomain(loc, locToMemory),
      );
    }

    // Single color
    return remapDomains(() => 'all', () => 'all');
  });

  // ── Memory colors ─────────────────────────────────────────────────────
  const memoryColors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f97583', '#56d4dd'];
  const memoryColorMap = $derived.by(() => {
    const map: Record<string, string> = {};
    const urns = [...new Set(nodes.map((n) => n.memory?.urn ?? ''))];
    urns.forEach((u, i) => { map[u] = memoryColors[i % memoryColors.length]; });
    return map;
  });

  // Memory name lookup + read-only status by URN
  const memoryNameMap = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      if (n.memory?.urn && n.memory.name) map[n.memory.urn] = n.memory.name;
    }
    return map;
  });
  const memoryReadOnlyMap = $derived.by(() => {
    if (writableSet.size === 0) return {} as Record<string, boolean>;
    const map: Record<string, boolean> = {};
    for (const n of nodes) {
      if (n.memory?.urn) map[n.memory.urn] = !writableSet.has(n.memoryId);
    }
    return map;
  });
</script>

<svelte:window onclick={handleWindowClick} />

<div class="flex flex-col gap-3">
  <!-- Filter bar -->
  <div class="flex items-center gap-2 flex-wrap">
    <!-- Memory dropdown -->
    {#if multiMemory && availableMemoryUrns.length > 1}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('memory')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeMemoryUrns.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Memories {#if activeMemoryUrns.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeMemoryUrns.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'memory' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'memory'}
          <div class="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeMemoryUrns.size > 0}
              <button onclick={() => { activeMemoryUrns = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableMemoryUrns as urn}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeMemoryUrns.has(urn)} onchange={() => toggleMemory(urn)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                <span class="inline-block h-2 w-2 rounded-full shrink-0" style="background: {memoryReadOnlyMap[urn] ? '#8b949e' : (memoryColorMap[urn] ?? '#8b949e')};"></span>
                <span class="truncate">{memoryNameMap[urn] ?? urn}{memoryReadOnlyMap[urn] ? ' (read-only)' : ''}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Node type dropdown -->
    {#if availableNodeTypes.length > 1}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('type')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeNodeTypes.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Node Types {#if activeNodeTypes.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeNodeTypes.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'type' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'type'}
          <div class="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeNodeTypes.size > 0}
              <button onclick={() => { activeNodeTypes = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableNodeTypes as t}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeNodeTypes.has(t)} onchange={() => toggleNodeType(t)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                {t}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Tags dropdown -->
    {#if availableTags.length > 0}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('tags')}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {activeTags.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Tags {#if activeTags.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeTags.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'tags' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'tags'}
          <div class="absolute left-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeTags.size > 0}
              <button onclick={() => { activeTags = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each availableTags as t}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={activeTags.has(t)} onchange={() => toggleTag(t)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                {t}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Search (issue #355): one box, server-backed node-content search -->
    <input type="text" placeholder="Search content…" bind:value={keyword}
      class="w-48 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />

    <!-- Search mode (#431): Exact = keyword FTS (whole-word, ranked);
         Regex = pattern / substring match (foo matches foobar); Fuzzy =
         semantic vector search (needs a vector index). -->
    <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
      title="Exact: whole-word keyword match. Regex: pattern / substring match. Fuzzy: semantic search (needs a vector index).">
      <button type="button" onclick={() => searchMode = 'exact'}
        class="px-2.5 py-1 text-xs {searchMode === 'exact' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}">Exact</button>
      <button type="button" onclick={() => searchMode = 'regex'}
        class="px-2.5 py-1 text-xs {searchMode === 'regex' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}">Regex</button>
      <button type="button" onclick={() => searchMode = 'fuzzy'}
        class="px-2.5 py-1 text-xs {searchMode === 'fuzzy' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}">Fuzzy</button>
    </div>

    <!-- #433: Fields weight-mask — scope a LEXICAL query's scoring to a subset
         of node fields (a ranking mask, not a hard filter). Only meaningful for
         Exact/Regex; hidden for Fuzzy (vector retrieval ignores it). -->
    {#if lexicalMode}
      <div class="relative filter-dropdown">
        <button type="button" onclick={() => toggleDropdown('fields')}
          title="Scope the search to specific fields (ranking weight, not a hard filter)"
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
            {searchFields.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Fields {#if searchFields.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{searchFields.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'fields' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'fields'}
          <div class="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p class="px-2 pb-1 text-[10px] leading-tight text-zinc-400">Ranking weight — narrows what scores a match, not a hard filter. All fields when none selected.</p>
            {#if searchFields.size > 0}
              <button type="button" onclick={() => { searchFields = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#each NODE_FIELD_MASK_OPTIONS as f}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type="checkbox" checked={searchFields.has(f)} onchange={() => toggleField(f)}
                  class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                {f}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- #429: My nodes (server-side filter.createdBy) — needs the caller's id -->
    {#if currentUserId}
      <button type="button" onclick={() => (myNodesOnly = !myNodesOnly)}
        title="Show only nodes you created"
        class="rounded-lg border px-3 py-1.5 text-xs font-medium transition
          {myNodesOnly ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}"
      >My nodes</button>
    {/if}

    <!-- #429: Changed since (server-side filter.updatedAfter) -->
    <select bind:value={changedSince} title="Filter by when nodes were last updated"
      class="rounded-lg border px-2 py-1.5 text-xs
        {changedSince !== 'any' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'}">
      <option value="any">Any time</option>
      <option value="24h">Last 24h</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
    </select>

    <!-- #429: Sort (server-side for updatedAt/relevance; loc is the browse default) -->
    <select bind:value={sortMode} title="Sort order"
      class="rounded-lg border px-2 py-1.5 text-xs
        {sortMode !== 'loc' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'}">
      <option value="loc">Sort: Location</option>
      <option value="updatedAt">Sort: Recently updated</option>
      <option value="relevance">Sort: Best match</option>
    </select>

    <!-- #433: Include deleted (server-side filter.includeDeleted) — audit /
         restore view; soft-deleted nodes are excluded by default. -->
    <button type="button" onclick={() => (includeDeleted = !includeDeleted)}
      title="Include soft-deleted nodes (audit / restore)"
      class="rounded-lg border px-3 py-1.5 text-xs font-medium transition
        {includeDeleted ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}"
    >Include deleted</button>

    {#if searching}
      <span class="text-xs text-zinc-400">Searching…</span>
    {/if}

    {#if hasActiveFilters}
      <button onclick={clearAllFilters} class="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Clear all</button>
    {/if}

    <!-- Right: view toggles + count. The Graph/Nodes toggle is hidden when the
         view is fixed by the tab layout (#266); the Tree/Table toggle shows
         whenever the nodes view is active. -->
    <div class="ml-auto flex items-center gap-3">
      {#if !forcedView}
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            onclick={() => storedView = 'graph'}
            class="px-2.5 py-1 text-xs {activeView === 'graph' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Graph</button>
          <button
            onclick={() => storedView = 'nodes'}
            class="px-2.5 py-1 text-xs {activeView === 'nodes' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Nodes</button>
        </div>
      {/if}
      {#if activeView === 'nodes'}
        {#if hasHiddenNodes}
          <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
            <input type="checkbox" bind:checked={showHidden}
              class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
            Show hidden
          </label>
        {/if}
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            onclick={() => nodesPane = 'tree'}
            class="px-2.5 py-1 text-xs {nodesPane === 'tree' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Tree</button>
          <button
            onclick={() => nodesPane = 'table'}
            class="px-2.5 py-1 text-xs {nodesPane === 'table' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Table</button>
        </div>
      {/if}
      <span class="text-xs text-zinc-400">
        {#if serverResults !== null}{searchedNodes.length} result{searchedNodes.length === 1 ? '' : 's'}{:else}{searchedNodes.length}{searchedNodes.length !== displayTotal ? ` / ${displayTotal}` : ''}{/if}
      </span>
    </div>
  </div>

  <!-- Search status: server error (red) or a degrade note (amber, e.g. fuzzy
       with no vector index → "try Exact"). -->
  {#if serverResults !== null && (searchError || searchNote)}
    <div class="text-xs {searchError ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}">
      {searchError ?? searchNote}
    </div>
  {/if}

  <!-- #429: the server result set is capped — say so instead of implying these
       are all the matches. -->
  {#if serverResults !== null && searchCapped}
    <div class="text-xs text-amber-600 dark:text-amber-400">
      Showing the first {(serverResults?.length ?? 0).toLocaleString()} matches — narrow the filters to see fewer.
    </div>
  {/if}

  <!-- #372: don't let the hidden-types filter swallow search matches silently.
       When a search hit record/system nodes that are currently hidden, say so
       and offer to reveal them — otherwise the result reads as a false empty. -->
  {#if hiddenSearchMatchCount > 0}
    <div class="text-xs text-amber-600 dark:text-amber-400">
      {hiddenSearchMatchCount}
      {hiddenSearchMatchCount === 1 ? 'match is a record/system node' : 'matches are record/system nodes'}
      hidden by default.
      <button type="button" onclick={() => (showHidden = true)} class="font-medium underline hover:no-underline">Show hidden</button>
    </div>
  {/if}

  <!-- #429: the loaded window is capped (5000) — when the memory has more, say
       so instead of silently truncating. The type/tag filters and the tree/graph
       reflect only this loaded set; the search box queries the whole memory. -->
  {#if serverResults === null && isTruncated}
    <div class="text-xs text-amber-600 dark:text-amber-400">
      {t(
        'memory-browser.truncated-notice',
        'Showing the first {loaded} of {total} nodes. The type/tag filters and the tree/graph reflect only this loaded set; the search box covers the whole memory.',
      )
        .replace('{loaded}', nodes.length.toLocaleString())
        .replace('{total}', (nodesTotal ?? 0).toLocaleString())}
    </div>
  {/if}

  <!-- Main area. Shared height is a CSS variable so the scrolling panes inherit
       one value (NodeList reads --memory-browser-h to bound its own scroll).
       Per code-review feedback on PR #211. -->
  {#if nodes.length === 0}
    <div class="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style="min-height: 400px;">
      No nodes to display.
    </div>
  {:else if activeView === 'graph'}
    <!-- Graph view: the tree stays as a navigation sidebar beside the graph —
         a complementary representation, not a duplicate of the table. -->
    <div class="flex gap-0" style="--memory-browser-h: calc(100vh - 320px); min-height: var(--memory-browser-h);">
      {#if treeOpen}
        <aside class="shrink-0 overflow-y-auto rounded-l-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="width: {treeWidth}px; max-height: var(--memory-browser-h);">
          <div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tree</span>
            <button onclick={() => treeOpen = false} class="text-zinc-500 hover:text-zinc-300" title="Close tree">&times;</button>
          </div>
          {#if moveError}
            <p class="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {moveError}
              <button type="button" class="ml-1 font-semibold hover:underline" aria-label="Dismiss move error" title="Dismiss" onclick={() => (moveError = null)}>×</button>
            </p>
          {/if}
          <TreeView entries={treeEntries} {basePath} hideSearch={true} nodeHrefFn={basePath ? undefined : treeNodeHrefFn} onselect={handleTreeSelect} onmove={handleTreeMove} onreorder={handleTreeReorder} bind:showHidden />
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-indigo-400 transition-colors dark:bg-zinc-800 dark:hover:bg-indigo-500"
          class:bg-indigo-400={dragging}
          class:dark:bg-indigo-500={dragging}
          onmousedown={startDrag}
        ></div>
      {:else}
        <button
          onclick={() => treeOpen = true}
          class="mr-2 self-start rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title="Show tree"
        >
          Tree &rsaquo;
        </button>
      {/if}

      <div class="min-w-0 flex-1 overflow-hidden {treeOpen ? 'rounded-r-lg' : 'rounded-lg'} border border-zinc-200 dark:border-zinc-800">
        <div style="display: flex; height: 100%;">
          {#key filteredNodes.length + ':' + [...activeMemoryUrns].join(',') + ':' + [...activeNodeTypes].join(',') + ':' + [...activeTags].join(',') + ':' + keyword}
            <TopicGraph data={graphViewData} {focusId} {basePath} />
          {/key}
        </div>
      </div>
    </div>
  {:else}
    <!-- Nodes view: tree OR table, full width — chosen via the toggle above.
         Both are representations of the same node set, so we show one at a
         time rather than side-by-side. -->
    <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
      style="--memory-browser-h: calc(100vh - 320px); min-height: var(--memory-browser-h);">
      {#if nodesPane === 'tree'}
        <div class="overflow-y-auto bg-zinc-50 dark:bg-zinc-950" style="max-height: var(--memory-browser-h);">
          {#if moveError}
            <p class="m-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {moveError}
              <button type="button" class="ml-1 font-semibold hover:underline" aria-label="Dismiss move error" title="Dismiss" onclick={() => (moveError = null)}>×</button>
            </p>
          {/if}
          <TreeView entries={treeEntries} {basePath} hideSearch={true} nodeHrefFn={basePath ? undefined : treeNodeHrefFn} onmove={handleTreeMove} onreorder={handleTreeReorder} bind:showHidden />
        </div>
      {:else}
        <div class="p-4">
          <!-- hideSearch: the single search box lives in MemoryBrowser now
               (issue #355 — was two boxes); NodeList's own box would be the
               redundant second field. -->
          <NodeList nodes={searchedNodes} {basePath} memoryUrn={singleMemoryUrn ?? ''} listKey={nodeListKey} hideSearch={true} snippets={searchSnippets} meta={searchMeta} />
        </div>
      {/if}
    </div>
  {/if}
</div>
