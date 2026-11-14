<script lang="ts">
  import TreeView from './TreeView.svelte';
  import TopicGraph from './TopicGraph.svelte';
  import NodeList from './NodeList.svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { graphState } from './GraphState.svelte';
  import { buildGraphViewData, buildTreeEntries } from '$lib/graph-utils';
  import { isHiddenNodeType } from '$lib/node-types';
  import type { ContentScope } from '$lib/comments';
  import { onDestroy, tick, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { createNodeColumns } from '$lib/node-columns.svelte';
  import { NODE_FIELD_MASK_OPTIONS } from '$lib/search/node-fields';
  import PropertyFilter from '$lib/components/PropertyFilter.svelte';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import { treeReorderAllowed } from './memory-browser-reorder';
  import type { ListPageNavigation } from '$lib/list-page';
  import { objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import type { Memory, MemoryNode, TreeEntry, SearchHitMeta } from '$lib/types';
  import type { NodeColumnRow } from '$lib/node-columns';
  import type { AppScopedMemory } from '$lib/app-memory-scope';

  /** Build the URL to a node's detail page, or empty if memory context is missing */
  function nodeHref(node: MemoryNode, base: string): string {
    if (base) return `${base}/nodes/${node.id}`;
    // #260: memory pages are org-less, so the fallback needs only the memory id.
    const memId = memoryIdentity(node)?.id;
    if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
    return '';
  }

  let {
    nodes,
    nodesTotal = null,
    basePath = '',
    multiMemory = false,
    readOnly = false,
    writableMemoryIds = [],
    scopeMemoryIds = [],
    scopeMemories = [],
    forcedView,
    memory = null,
    refreshKey = 0,
    serverPage = null,
    pageLabel = null,
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
    /** Single-memory pages carry the server write decision (#646). */
    readOnly?: boolean;
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
    /** Authorized leaf identities; never fabricate a nested Memory record. */
    scopeMemories?: Pick<AppScopedMemory, 'memoryId' | 'memoryUrn' | 'name'>[];
    /** When set (the #266 tab layout), fixes the view and hides the toggle. */
    forcedView?: 'graph' | 'nodes';
    /**
     * #589: the browsed memory (single-memory pages only) — drives the
     * structured-query UI off its property schema (declared collections →
     * objectType facet + field suggestions) and its encryption flag (the
     * `data` column is ciphertext at rest, so where/sortProperty over `data`
     * can't match there). Absent on multi-memory pages (agent/app), where the
     * structured controls fall back to schema-less behavior.
     */
    memory?: Memory | null;
    /**
     * #992: bump to re-run an active server view after a write changed what
     * its filters match (e.g. Approve all under "Not approved"). The browse
     * set is the load's; this only refreshes server results.
     */
    refreshKey?: number;
    /** A server-owned browse window. Search/filter results replace it and hide this pager. */
    serverPage?: ListPageNavigation | null;
    pageLabel?: string | null;
  } = $props();

  const scopeIdentity = $derived(new Map(scopeMemories.map(row => [row.memoryId, { id: row.memoryId, urn: row.memoryUrn, name: row.name }])));
  function memoryIdentity(node: MemoryNode) {
    return scopeIdentity.get(node.memoryId) ?? node.memory ?? null;
  }

  const writableSet = $derived(new Set(writableMemoryIds));

  // #429: the loaded window is truncated when the server's full count exceeds
  // the rows we actually loaded. Drives the "N of M" count + a notice so the
  // truncation is no longer silent.
  const displayTotal = $derived(serverPage?.total ?? nodesTotal ?? nodes.length);
  const isTruncated = $derived((serverPage?.total ?? nodesTotal) != null && nodes.length < displayTotal);

  // The single memory being browsed, as carried by basePath
  // (`/app/memories/<id>`); undefined on the multi-memory global browse
  // page. One derivation for every memory-scoped key or lookup (saved
  // views, sort persistence, search scope) so they cannot drift apart.
  const memoryIdFromBasePath = $derived(
    basePath && !multiMemory ? basePath.split('/').pop() : undefined,
  );

  // Saved-views key for the flat node list (spec 020), scoped to the single
  // memory being browsed. Only set when viewing one memory's detail (basePath
  // is `/app/memories/<id>`); absent on the multi-memory global browse page.
  const nodeListKey = $derived(
    memoryIdFromBasePath ? `memory:${memoryIdFromBasePath}:nodes` : undefined,
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
  let contentScope = $state<ContentScope>('CONTENT');
  // Comment hits are feedback listed with their author and target, which only
  // the table presents (#1054 review: the tree and graph panes would drop the
  // marking and link the comment node, not its target's Discussion). While a
  // Comments or All scope is on, the table is the one presentation.
  const commentsInView = $derived(contentScope !== 'CONTENT');
  const activeView = $derived(commentsInView ? 'nodes' : (forcedView ?? storedView));
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

  // #747: three states, not two. `null` means "nobody has chosen — follow the
  // viewport" and is the initial value; true/false are an explicit user choice
  // that holds at every width.
  //
  // Same shape as the /app shell's sidebar (#740), and deliberately so: this is
  // the second two-pane layout to hit the same wall, and one pattern is better
  // than two. As there, the viewport half is decided by CSS breakpoints rather
  // than matchMedia in an $effect — the portal server-renders, so a JS-decided
  // default is wrong in the SSR'd HTML and corrects on hydration, which is a
  // visible flash of a 256px tree on the phone this exists to fix.
  //
  // Below `sm` the tree would leave the graph ~50px of a 390px viewport, and
  // the panes CLIP rather than scroll — so the graph's own toolbar became
  // unreachable, with no scrollbar to reveal it.
  let treeOpen = $state<boolean | null>(null);
  let treeWidth = $state(256);
  let dragging = $state(false);

  // The one "show hidden nodes" toggle, honoured by all three panes — the tree
  // (via the bindable prop), the table, and, since #706, the graph. The UI is
  // the filter-bar checkbox below; TreeView's own duplicate was removed in the
  // same issue, so this is the only control that writes it.
  //
  // #706: PERSISTED, like `storedView` and `nodesPane` above. Revealing hidden
  // nodes and then navigating used to silently re-hide them, which reads as the
  // nodes disappearing again rather than as a filter resetting — the same
  // confusion the toggle exists to remove. Same SSR dance as `nodesPane`:
  // seed a deterministic default so the server render matches, then hydrate the
  // stored value in the first effect run and persist changes after it.
  const SHOW_HIDDEN_KEY = 'hadron:memoryBrowser:showHidden';
  function readStoredShowHidden(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(SHOW_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  }
  let showHidden = $state(false);
  let showHiddenHydrated = false;
  $effect(() => {
    if (!showHiddenHydrated) {
      showHiddenHydrated = true;
      const stored = readStoredShowHidden();
      if (stored !== showHidden) showHidden = stored;
      return;
    }
    try {
      window.localStorage.setItem(SHOW_HIDDEN_KEY, showHidden ? '1' : '0');
    } catch {
      /* ignore quota / disabled storage */
    }
  });

  // When the URL carries ?focus=<nodeId>, we forward it to TopicGraph so
  // the node is selected and centered, and we switch to the graph view.
  const focusId = $derived($page.url.searchParams.get('focus') ?? undefined);
  $effect(() => {
    if (focusId && !forcedView) storedView = 'graph';
  });

  // #706 review (Codex): the node page's "Graph" link is UNCONDITIONAL — every
  // node's Settings tab offers it, including a record/system one. Before this
  // PR the graph carried every node, so focusing a hidden one worked by
  // accident. Now that the graph honours the filter, following that link with
  // the toggle off would build a graph WITHOUT the requested node:
  // `TopicGraph.focusNode` would not find it in `data.topics` and the graph
  // would open having selected and centred nothing, with no error — the reader
  // asked to see one specific node and got a graph that silently lacks it.
  //
  // Reveal instead of refusing. Following that link IS the request to see the
  // node, so honouring it is what the user asked for, and flipping the visible
  // toggle says plainly why hidden nodes are now shown — the alternative
  // (keeping just the focused node while the toggle reads "off") is a pane
  // disagreeing with its own control, which is the defect this whole issue is
  // about. It writes the persisted preference, deliberately: a silent one-off
  // exception would leave the reader unable to explain what they are seeing.
  //
  // Reveal ONCE PER FOCUS TARGET, and never read `showHidden` here. Guarding on
  // `showHidden` made this effect depend on the very state it writes:
  // unchecking the box set it false, which re-ran the effect, which saw the
  // same still-hidden `focusId` and set it true again — so the checkbox could
  // not be turned off at all while `?focus=` stayed in the URL. That is
  // `hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect`, and it is the SAME one-way
  // switch this file warns about at `hasHiddenNodes`: I wrote that warning in
  // this PR and then built the trap from the other direction.
  //
  // `autoRevealedFor` is a plain `let`, not `$state` — it must not become a
  // dependency either, the same reason `showHiddenHydrated` above is plain.
  // Re-running on `filteredNodes` IS wanted: the node list arrives after mount,
  // so the first pass usually has nothing to match yet.
  let autoRevealedFor: string | null = null;
  $effect(() => {
    const id = focusId;
    if (!id || id === autoRevealedFor) return;
    if (filteredNodes.some((n) => n.id === id && isHiddenNode(n))) {
      autoRevealedFor = id;
      showHidden = true;
    }
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
    // Reassigning seq 1…N is valid only for a COMPLETE sibling set. A server
    // page or filtered result set can omit siblings and duplicate their seq.
    if (!reorderSafe) return;
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
  onDestroy(() => { graphState.searchFilter = ''; graphState.searchResultNodeIds = null; });

  // portal#1174: the Nodes tab's Role / Last changed / Changed by / Revision /
  // Approved / Signed columns. They are not on the slim rows the layout loads,
  // so they are read here, lazily, for the rows on the DISPLAYED page only
  // (hrn:node:hadronmemory.com:hadron-portal:review:shared-layout-payload-consumers).
  const nodeColumns = createNodeColumns(async (refs) => {
    const res = await fetch('/api/nodes/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs }),
    });
    if (!res.ok) throw new Error(`columns ${res.status}`);
    return (await res.json()) as { rows: NodeColumnRow[]; unavailable: string[]; omitted: string[]; signing?: boolean };
  });
  onDestroy(() => nodeColumns.destroy());
  // The rows on screen, as NodeList last reported them, so a refresh can re-read
  // exactly those.
  let columnIds: string[] = [];
  function showColumnsFor(ids: string[]) {
    columnIds = ids;
    void nodeColumns.ensure(ids);
  }
  // An approval or mint changes what Approved/Signed/Revision say, and the
  // layout bumps `refreshKey` after those actions; the cached columns are then
  // stale, so forget them and read the page again (Gizelle on #1181).
  let columnsRefreshKey = untrack(() => refreshKey);
  $effect(() => {
    const key = refreshKey;
    if (key === columnsRefreshKey) return;
    columnsRefreshKey = key;
    untrack(() => {
      nodeColumns.reset();
      void nodeColumns.ensure(columnIds);
    });
  });

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
  // portal#1223: the user's EXPLICIT Sort choice persists per memory (the
  // nodeListKey scoping convention), so a reload or Back lands on the same
  // order instead of silently snapping to Location. Unscoped on the
  // multi-memory browse page, where there is no one memory to key on — as
  // with nodeListKey, no key means no persistence. The restored value keeps
  // its server-side meaning: updatedAt/relevance re-enter the server view
  // and stay SERVER-sorted, never a client approximation of the loaded page.
  // Retired or invalid stored values fall back to 'loc'.
  const sortScopeKey = $derived(memoryIdFromBasePath ? `:${memoryIdFromBasePath}` : '');
  function readStoredSort(): 'loc' | 'updatedAt' | 'relevance' {
    if (typeof window === 'undefined' || !sortScopeKey) return 'loc';
    try {
      const v = window.localStorage.getItem(`hadron:memoryBrowser:sort${sortScopeKey}`);
      return v === 'updatedAt' || v === 'relevance' ? v : 'loc';
    } catch {
      return 'loc';
    }
  }
  // Persistence is keyed to the EVENT, not the value: the select's change
  // event is the one place an explicit user choice happens, so it — and only
  // it — writes storage. Keying on the value instead would refuse an
  // explicit revert to Location ("still the seed") and let programmatic
  // resets like clearAllFilters rewrite the stored preference; it also
  // leaves the hydration effect below purely reading storage, never
  // writing (no read-modify-write on sortMode).
  function persistSortChoice(value: string): void {
    if (typeof window === 'undefined' || !sortScopeKey) return;
    if (value !== 'loc' && value !== 'updatedAt' && value !== 'relevance') return;
    try {
      window.localStorage.setItem(`hadron:memoryBrowser:sort${sortScopeKey}`, value);
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  // Hydrate per SCOPE, not once: SvelteKit reuses this component across
  // memory navigations, so the scope key can change under a live instance.
  // Re-seeding on every real memory scope keeps each memory's stored sort
  // (and the old memory's key) untouched. The empty scope seeds only on the
  // first run: after that, a transient unscoped render during a route-update
  // gap must not discard the user's active sort on the multi-memory page.
  let hydratedSortScope: string | undefined;
  $effect(() => {
    if (typeof window === 'undefined') return;
    const scope = sortScopeKey;
    if (scope === hydratedSortScope) return;
    if (scope === '' && hydratedSortScope !== undefined) return;
    hydratedSortScope = scope;
    sortMode = readStoredSort();
  });
  // #433: include soft-deleted nodes (findNodes filter.includeDeleted) — an
  // audit/restore view; server-only (the slim loaded set excludes deleted).
  let includeDeleted = $state(false);
  // #992 (server #1591): approval and minting state, both answered by the
  // server (findNodes filter) so the list never reads approval per row.
  let approvalFilter = $state<'' | 'APPROVED' | 'NOT_APPROVED' | 'SUPERSEDED' | 'NOT_APPLICABLE'>('');
  let mintedFilter = $state<'any' | 'minted' | 'unminted'>('any');
  // portal#1015 (hrn:node:hadronmemory.com:specs:cor:dmo:110:08): Content / Comments / All. Content is the
  // default (the server's too). The SERVER applies it before ranking, paging and
  // the 500-hit cap, so Comments finds every matching comment, not the comments
  // among the first 500 general hits.
  // #433: the fields weight-mask (findNodes fields, hrn:node:hadronmemory.com:specs:cor:api:090:03) — scopes a
  // LEXICAL query's scoring to a subset of node fields. Empty = all fields
  // (the server default). Ignored for Fuzzy (vector retrieval) and for a
  // filter-only list (no ranking). Options are shared with the endpoint's
  // validation via $lib/search/node-fields so the two can't drift.
  let searchFields = $state<Set<string>>(new Set());
  const lexicalMode = $derived(searchMode === 'exact' || searchMode === 'regex');

  // #589 (server #719/#725): structured query over a node's properties/data.
  // objectType is the collection facet; `where` is the recursive predicate
  // (a schema-aware leaf builder plus Advanced JSON for the full grammar).
  // sortProperty orders by a JSON path and
  // overrides the sort enum. All three are server-side dimensions (the slim
  // loaded set carries no properties), so any of them puts the browser into
  // server view.
  const memorySchema = $derived(readMemorySchema(memory?.schema));
  const collectionNames = $derived(objectTypeNames(memorySchema));
  const memoryEncrypted = $derived(!!memory?.isEncrypted);
  let objectTypeFilter = $state('');
  let collectionControl = $state<HTMLSelectElement | HTMLInputElement>();
  let whereJson = $state('');
  let propertyFilterStatus = $state('');
  let propertyEditorVersion = $state(0);
  // A declared field belongs to one memory/collection. Reused route instances
  // must not carry its applied predicate into the next memory.
  const propertyMemoryScope = $derived(`${basePath}:${memory?.id ?? ''}`);
  let propertyScope: string | undefined;
  $effect(() => {
    const scope = propertyMemoryScope;
    if (scope === propertyScope) return;
    propertyScope = scope;
    propertyFilterStatus = '';
    objectTypeFilter = '';
    whereJson = '';
  });
  const whereParse = $derived.by(() => {
    const trimmed = whereJson.trim();
    if (!trimmed) return { value: null as Record<string, unknown> | null, error: null as string | null };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { value: null, error: 'Filter must be a JSON object.' };
      }
      return { value: parsed as Record<string, unknown>, error: null };
    } catch {
      return { value: null, error: 'Filter is not valid JSON.' };
    }
  });
  let sortPropPath = $state('');
  let sortPropField = $state<'properties' | 'data'>('properties');
  let sortPropAs = $state<'text' | 'number' | 'datetime' | 'boolean'>('text');
  let sortPropDir = $state<'asc' | 'desc'>('asc');
  // Dot-separated path → the server's array-of-keys shape.
  const sortPropPathSegments = $derived(sortPropPath.split('.').map((s) => s.trim()).filter(Boolean));
  // Field-name suggestions for the where/sort path inputs: the selected
  // collection's declared fields, or every declared field when no facet is set.
  const declaredFieldNames = $derived.by(() => {
    if (!memorySchema) return [] as string[];
    const collections = objectTypeFilter && memorySchema.objectTypes[objectTypeFilter]
      ? [memorySchema.objectTypes[objectTypeFilter]]
      : Object.values(memorySchema.objectTypes);
    return [...new Set(collections.flatMap((c) => Object.keys(c.fields)))].sort();
  });
  // A declared field's type IS its query cast (#725) — auto-pick the cast
  // when the typed path names a declared field (enum casts as text). Scoped
  // to the SELECTED collection when the facet is set — the same field name
  // can carry different types across collections, and the first-declared
  // type would win otherwise (PR #617 review, Codex P2). Falls back to
  // scanning every collection only when no facet narrows it.
  function syncSortCastFromSchema() {
    if (!memorySchema || sortPropField !== 'properties' || sortPropPathSegments.length !== 1) return;
    const name = sortPropPathSegments[0];
    const collections = objectTypeFilter && memorySchema.objectTypes[objectTypeFilter]
      ? [memorySchema.objectTypes[objectTypeFilter]]
      : Object.values(memorySchema.objectTypes);
    for (const c of collections) {
      const declared = c.fields[name];
      if (declared) {
        sortPropAs = declared.type === 'enum' ? 'text' : declared.type;
        return;
      }
    }
  }

  // One native radio group per instance: a shared name lets one browser's tag
  // choice uncheck another's without its state knowing (#1929 BLIND P3).
  const instanceId = $props.id();
  const tagGroupName = `server-paged-tag-${instanceId}`;
  let activeMemoryUrns = $state<Set<string>>(new Set());
  let activeNodeTypes = $state<Set<string>>(new Set());
  let activeTags = $state<Set<string>>(new Set());

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
    objectType: objectTypeFilter || null,
    where: whereParse.value,
    approvalState: approvalFilter || null,
    minted: mintedFilter === 'any' ? null : mintedFilter === 'minted',
    contentScope: contentScope === 'CONTENT' ? null : contentScope,
    // #1058 + #1881: server-side type/tag refinement applies only to CONTENT.
    // Under COMMENTS/ALL it would remove comment hits before the local
    // comment-preserving refinement below can run.
    nodeTypes: serverPage !== null && contentScope === 'CONTENT' && activeNodeTypes.size > 0 ? [...activeNodeTypes].sort() : null,
    tags: serverPage !== null && contentScope === 'CONTENT' && activeTags.size > 0 ? [...activeTags].sort() : null,
  });
  // A stable key for the fields mask — a fresh Set identity on every toggle
  // would re-run the search effect even when the selection is unchanged (same
  // guard as searchMemoryIdsStr). Only lexical modes send it.
  const searchFieldsStr = $derived(lexicalMode ? [...searchFields].sort().join(',') : '');
  // In server view, serverResults replaces the loaded set as the working pool.
  // #589: a non-empty (even invalid) where text counts — an invalid predicate
  // must show its error over an empty result set, not silently browse.
  // #1929 BLIND P2: on a server page the Memory filter narrows memoryIds and
  // nothing else, so the request must say the scope IS the query, or the
  // endpoint's bare-browse shortcut answers "nothing to do".
  const memoryScopedBrowse = $derived(serverPage !== null && activeMemoryUrns.size > 0);
  const serverViewActive = $derived(
    keyword.trim() !== '' ||
      (serverPage !== null && activeMemoryUrns.size > 0) ||
      (serverPage !== null && activeNodeTypes.size > 0) ||
      (serverPage !== null && activeTags.size > 0) ||
      !!serverFilter.createdBy ||
      !!serverFilter.updatedAfter ||
      !!serverFilter.includeDeleted ||
      !!serverFilter.objectType ||
      !!serverFilter.approvalState ||
      serverFilter.minted !== null ||
      !!serverFilter.contentScope ||
      whereJson.trim() !== '' ||
      sortPropPathSegments.length > 0 ||
      sortMode === 'updatedAt' ||
      sortMode === 'relevance',
  );

  // The memory set to search = the distinct memories in the loaded nodes
  // (memory page → one; agent/app → several). Empty ⇒ nothing to search.
  // Derive a STABLE string key, not an array: `nodes` gets a new identity on
  // every reorder/invalidate, and a fresh array reference would re-run the
  // search effect each time even when the id set is unchanged (PR #358 review).
  const searchMemoryIdsStr = $derived.by(() => {
    const selectedMemory = (urn: string | undefined) =>
      serverPage === null || activeMemoryUrns.size === 0 || activeMemoryUrns.has(urn ?? '');
    const ids = new Set(
      nodes.filter((n) => selectedMemory(memoryIdentity(n)?.urn)).map((n) => n.memoryId),
    );
    // #433: also include the page's declared scope so a memory with zero loaded
    // (non-deleted) rows stays searchable — the Include-deleted audit/restore
    // view must reach fully soft-deleted memories, which never appear in `nodes`.
    // A selected Memory filter narrows this SAME authorized scope server-side;
    // it no longer reports a false empty from the one browse page in hand.
    for (const row of scopeMemories) {
      if (selectedMemory(row.memoryUrn)) ids.add(row.memoryId);
    }
    for (const id of scopeMemoryIds) {
      if (serverPage === null || activeMemoryUrns.size === 0 || scopeMemories.length === 0) ids.add(id);
    }
    // Single-memory pages carry the memory id in basePath (/app/memories/<id>)
    // even when nothing loaded — recover it so an empty memory is searchable.
    if (memoryIdFromBasePath) ids.add(memoryIdFromBasePath);
    return [...ids].sort().join(',');
  });

  // Server search results: null = not in server view (show the normal browse set).
  let serverResults = $state<MemoryNode[] | null>(null);
  // #616 review (Codex): TopicGraph builds its vis datasets in onMount, so the
  // {#key} guarding it must change whenever the working set does — but a
  // structured where/objectType change can return a DIFFERENT set of the SAME
  // size, which none of the key's other terms see. Bump a version on every
  // serverResults assignment (via setServerResults) and include it in the key.
  let resultsVersion = $state(0);
  function setServerResults(v: MemoryNode[] | null) {
    serverResults = v;
    // `resultsVersion++` is a read-modify-write of a $state. setServerResults is
    // called SYNCHRONOUSLY from the debounce $effect below (the serverViewActive
    // reset branch fires on every load), so a plain `++` would read resultsVersion
    // inside that effect's reactive scope — subscribing the effect to a signal it
    // then writes, an immediate self-invalidation loop (effect_update_depth_exceeded,
    // #619). untrack the read so the counter still bumps for the graph {#key} but
    // never becomes a dependency of the caller.
    resultsVersion = untrack(() => resultsVersion) + 1;
  }
  // #531: mirror the server content-search hits (as node PKs) into the shared
  // tree/graph filter, so the Tree pane scopes to the SAME matches the table
  // lists. TreeView's own filter is name/id-substring only and would hide a
  // tag/body-only hit. Keyed on the PK (n.id), not the loc — TreeEntry.nodeId /
  // Topic.id are PKs, and a raw server loc wouldn't match the URN-prefix-
  // normalized tree/graph entries. Gated on a non-empty text query (not filter-
  // only server views) so `keyword` is always set alongside it — that keeps
  // TreeView's auto-expand + "No matches" logic (which keys on the query)
  // intact. Null → tree shows the full set / uses its local filter.
  $effect(() => {
    graphState.searchResultNodeIds =
      keyword.trim() !== '' && serverResults ? new Set(serverResults.map((n) => n.id)) : null;
  });
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let searchNote = $state<string | null>(null);
  let searchNeedsIndex = $state(false);
  let searchCapped = $state(false); // server hit the result cap — showing a slice
  let searchSnippets = $state<Record<string, string>>({}); // #430 nodeId → matching passage
  let searchMeta = $state<Record<string, SearchHitMeta>>({}); // #432 nodeId → relevance/stale meta
  let searchDeletedIds = $state<string[]>([]); // #1161 ids the server reports deleted (Include deleted)
  let searchSeq = 0; // monotonic — drops out-of-order responses

  // #589: the sortProperty payload in the server's shape (array path). Derived
  // from primitive state so its identity only changes when the inputs do.
  const sortPropertyPayload = $derived(
    sortPropPathSegments.length > 0
      ? { path: sortPropPathSegments, field: sortPropField, as: sortPropAs, direction: sortPropDir }
      : null,
  );

  type ServerSearchResponse = {
    nodes?: MemoryNode[];
    note?: string | null;
    reason?: string | null;
    degraded?: string[] | string;
    capped?: boolean;
    snippets?: Record<string, string>;
    meta?: Record<string, SearchHitMeta>;
    deletedIds?: string[];
    error?: string;
  };

  async function runServerFetch(
    q: string,
    mode: 'exact' | 'regex' | 'fuzzy',
    memoryIds: string[],
    filter: {
      createdBy: string | null;
      updatedAfter: string | null;
      updatedBefore: string | null;
      includeDeleted: boolean | null;
      objectType: string | null;
      where: Record<string, unknown> | null;
      approvalState: string | null;
      minted: boolean | null;
      contentScope: string | null;
      nodeTypes: string[] | null;
      tags: string[] | null;
    },
    sort: 'loc' | 'updatedAt' | 'relevance',
    sortProperty: { path: string[]; field: string; as: string; direction: string } | null,
    fields: string[],
    signal?: AbortSignal,
    scopedBrowse = false,
  ) {
    if (memoryIds.length === 0) { setServerResults([]); searching = false; return; }
    const seq = ++searchSeq;
    searching = true;
    searchError = null;
    searchNote = null;
    searchNeedsIndex = false;
    searchCapped = false;
    searchSnippets = {};
    searchMeta = {};
    searchDeletedIds = [];
    try {
      const res = await fetch('/api/nodes/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, mode, memoryIds, filter, sort, sortProperty, fields, ...(scopedBrowse ? { scopedBrowse: true } : {}) }),
        signal,
      });
      const data = await res.json() as ServerSearchResponse;
      if (seq !== searchSeq) return; // a newer request superseded this one
      if (!res.ok) { searchError = data.error ?? 'Search failed'; setServerResults([]); return; }
      setServerResults(data.nodes ?? []);
      searchNote = data.note ?? null;
      searchNeedsIndex = data.reason === 'no_vector_index' || data.degraded?.includes('no_vector_index') === true;
      searchCapped = !!data.capped;
      searchSnippets = data.snippets ?? {};
      searchMeta = data.meta ?? {};
      searchDeletedIds = Array.isArray(data.deletedIds) ? data.deletedIds : [];
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // superseded / destroyed
      if (seq !== searchSeq) return;
      searchError = e instanceof Error ? e.message : 'Search failed';
      setServerResults([]);
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
    const scoped = memoryScopedBrowse;
    const filter = serverFilter;
    const sort = sortMode;
    const sortProperty = sortPropertyPayload;
    const whereError = whereParse.error;
    const fieldsStr = searchFieldsStr; // tracked dep; '' when non-lexical
    void refreshKey; // tracked dep: a bump re-runs an active server view (#992)
    if (!serverViewActive) {
      searchSeq++;
      setServerResults(null);
      searching = false;
      searchError = null;
      searchNote = null;
      searchNeedsIndex = false;
      searchCapped = false;
      searchSnippets = {};
      searchMeta = {};
    searchDeletedIds = [];
      return;
    }
    const ids = idsStr ? idsStr.split(',') : [];
    // #589: an unparseable where predicate — inline error instead of firing
    // (same posture as the invalid-regex guard below; the server's own
    // grammar rejections still arrive as a 400 through searchError).
    if (whereError) {
      searchSeq++;
      setServerResults([]);
      searching = false;
      searchError = whereError;
      searchNote = null;
      searchNeedsIndex = false;
      searchCapped = false;
      searchSnippets = {};
      searchMeta = {};
    searchDeletedIds = [];
      return;
    }
    // #431: validate a regex pattern client-side — the server 400s on invalid
    // patterns (e.g. an unbalanced `(`); show an inline error instead of firing.
    if (mode === 'regex' && q) {
      try {
        new RegExp(q);
      } catch {
        searchSeq++;
        setServerResults([]);
        searching = false;
        searchError = 'Invalid regex pattern.';
        searchNote = null;
        searchNeedsIndex = false;
        searchCapped = false;
        searchSnippets = {};
        searchMeta = {};
    searchDeletedIds = [];
        return;
      }
    }
    const fields = fieldsStr ? fieldsStr.split(',') : [];
    const controller = new AbortController();
    const timer = setTimeout(() => runServerFetch(q, mode, ids, filter, sort, sortProperty, fields, controller.signal, scoped), 300);
    return () => {
      clearTimeout(timer);
      searchSeq++; // invalidate even a transport that ignores abort, before the next debounce
      controller.abort(); // cancel an in-flight fetch on new keystroke / destroy
    };
  });

  // ── Filters ───────────────────────────────────────────────────────────
  const availableMemoryUrns = $derived([...new Set([...scopeMemories.map(m => m.memoryUrn), ...nodes.map(n => memoryIdentity(n)?.urn ?? '')])].filter(Boolean).sort());
  const availableNodeTypes = $derived([...new Set([...nodes.map((n) => n.nodeType ?? 'info'), ...activeNodeTypes])].sort());
  const availableTags = $derived([...new Set([...nodes.flatMap((n) => n.tags ?? []), ...activeTags])].sort());

  let customNodeType = $state('');
  let customTag = $state('');
  let nodeTypeFilterError = $state('');
  function allowNodeType(value: string): boolean {
    if (serverPage !== null && value === 'comment') {
      nodeTypeFilterError = t('memory-browser.comment-type-guidance', 'To show comments, use the Show filter and choose Comments.');
      return false;
    }
    nodeTypeFilterError = '';
    return true;
  }
  function addCustomNodeType() {
    const value = customNodeType.trim();
    if (!value || !allowNodeType(value)) return;
    activeNodeTypes = new Set([...activeNodeTypes, value]);
    customNodeType = '';
  }
  function addCustomTag() {
    const value = customTag.trim();
    if (!value) return;
    activeTags = serverPage !== null ? new Set([value]) : new Set([...activeTags, value]);
    customTag = '';
  }
  // portal#1058 V74 (hrn:node:hadronmemory.com:hadron-dev-team-shared:decisions:2026-11-11-vera-rulings-portal-search-guidance):
  // Node Types and Tags refine content only. A comment hit has no tags and the
  // type `comment`, so applying them to it would silently empty the comment
  // results. Under Comments the two controls are disabled (a choice made under
  // Content is kept, not applied); under All they filter only the content rows.
  const refinementsOff = $derived(contentScope === 'COMMENTS');
  // portal#1930 (Uma 6787706001): the reason is visible page text, not a
  // hover title, and only when there is a disabled control for it to explain.
  // A server-paged browser offers the menus even when this page has no variety:
  // their add-a-value inputs filter the whole scope (#1881).
  const showTypeFilter = $derived(availableNodeTypes.length > 1 || serverPage !== null);
  const showTagsFilter = $derived(availableTags.length > 0 || serverPage !== null);
  const REFINEMENT_HINT_ID = 'refinement-off-hint';
  const refinementHintShown = $derived(refinementsOff && (showTypeFilter || showTagsFilter));
  const refinementHintId = $derived(refinementHintShown ? REFINEMENT_HINT_ID : undefined);

  // Dropdown open state
  let openDropdown = $state<'memory' | 'type' | 'tags' | 'fields' | 'properties' | null>(null);
  // Close at the user's scope change, even if another change happens before
  // effects flush. Keep selections and unrelated menus intact.
  function changeContentScope(value: ContentScope) {
    contentScope = value;
    if (value === 'COMMENTS' && (openDropdown === 'type' || openDropdown === 'tags')) {
      openDropdown = null;
    }
  }

  function toggleDropdown(d: 'memory' | 'type' | 'tags' | 'fields' | 'properties') {
    openDropdown = openDropdown === d ? null : d;
  }

  function handleWindowClick(e: MouseEvent) {
    // Discard can remove its own button before this listener runs. The event's
    // dispatch path retains the original dropdown even when target.closest cannot.
    const insideDropdown = e.composedPath().some(
      (target) => target instanceof Element && target.classList.contains('filter-dropdown'),
    );
    if (openDropdown && !insideDropdown) openDropdown = null;
  }

  // #589: how many structured-query controls are active — drives the
  // Properties button badge.
  const structuredActiveCount = $derived(
    (objectTypeFilter ? 1 : 0) + (whereJson.trim() ? 1 : 0) + (sortPropPathSegments.length > 0 ? 1 : 0),
  );

  const hasActiveFilters = $derived(
    activeMemoryUrns.size > 0 ||
      activeNodeTypes.size > 0 ||
      activeTags.size > 0 ||
      keyword.length > 0 ||
      myNodesOnly ||
      changedSince !== 'any' ||
      includeDeleted ||
      approvalFilter !== '' ||
      mintedFilter !== 'any' ||
      contentScope !== 'CONTENT' ||
      searchFields.size > 0 ||
      structuredActiveCount > 0 ||
      sortMode !== 'loc',
  );

  function changeCollection(typing = false) {
    if (whereJson.trim()) {
      propertyFilterStatus = t('property-filter.collection-cleared', 'Filter cleared because the collection changed.');
    } else if (!typing) {
      propertyFilterStatus = '';
    }
    // The first input event already cleared the predicate. Keep its notice
    // visible while subsequent events complete the free-text collection name.
    whereJson = '';
  }

  async function clearStructuredFilters() {
    propertyFilterStatus = t('property-filter.all-cleared', 'Property filters cleared.');
    objectTypeFilter = '';
    whereJson = '';
    sortPropPath = '';
    propertyEditorVersion++;
    await tick();
    collectionControl?.focus();
  }

  function clearAllFilters() {
    propertyFilterStatus = '';
    propertyEditorVersion++;
    activeMemoryUrns = new Set();
    activeNodeTypes = new Set();
    activeTags = new Set();
    nodeTypeFilterError = '';
    keyword = '';
    myNodesOnly = false;
    changedSince = 'any';
    includeDeleted = false;
    approvalFilter = '';
    mintedFilter = 'any';
    contentScope = 'CONTENT';
    searchFields = new Set();
    sortMode = 'loc';
    objectTypeFilter = '';
    whereJson = '';
    sortPropPath = '';
    sortPropField = 'properties';
    sortPropAs = 'text';
    sortPropDir = 'asc';
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
    if (!allowNodeType(t)) return;
    if (activeNodeTypes.has(t)) activeNodeTypes.delete(t);
    else activeNodeTypes.add(t);
    activeNodeTypes = new Set(activeNodeTypes);
  }

  function toggleTag(t: string) {
    if (serverPage !== null) {
      // One scoped query preserves global order and caps. The unpaged browser's
      // multi-tag OR control is unchanged; NodeFilter.tags itself is hasEvery.
      activeTags = activeTags.has(t) ? new Set() : new Set([t]);
      return;
    }
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
  // #706: `isHiddenNodeType` is the ONE definition, shared with TreeView.
  // When a server search is active, its results ARE the working set; otherwise
  // the loaded nodes. The memory/type/tag dropdowns refine whichever is shown.
  const displayNodes = $derived(serverResults ?? nodes);
  // portal#1015: a comment the reader ASKED for (Comments or All; the server
  // only returns one then, carrying `comment`) is a result, not clutter. Without
  // the ask no comment arrives, and the loaded set's comments stay hidden.
  function isHiddenNode(n: MemoryNode): boolean {
    return isHiddenNodeType(n.nodeType) && !n.comment;
  }
  const filteredNodes = $derived(
    displayNodes.filter((n) => {
      if (activeMemoryUrns.size > 0 && !activeMemoryUrns.has(memoryIdentity(n)?.urn ?? '')) return false;
      if (n.comment) return true;
      if (activeNodeTypes.size > 0 && !activeNodeTypes.has(n.nodeType ?? 'info')) return false;
      if (activeTags.size > 0 && !(n.tags ?? []).some((t) => activeTags.has(t))) return false;
      return true;
    })
  );

  // Whether the current (memory/type/tag-filtered) pool still contains hidden
  // nodes — gates the "Show hidden" control in the filter bar. That control is
  // the SINGLE toggle for all three panes; #706 removed TreeView's own
  // duplicate. Based on filteredNodes so it disappears when the active
  // memory/type/tag filters exclude every hidden node.
  //
  // It MUST read `filteredNodes`, never `visibleNodes`. On `visibleNodes` this
  // is false whenever the toggle is off — because that is precisely what the
  // toggle removed — so the control would vanish the moment you turned it off
  // and there would be no way to turn it back on. A one-way switch, reachable
  // by "simplifying" one identifier.
  const hasHiddenNodes = $derived(filteredNodes.some((n) => isHiddenNode(n)));
  // Renumbering is safe only over a complete sibling set; see treeReorderAllowed
  // for which browsers guard it (only server-paged ones — #1929 LOCAL F1).
  const reorderSafe = $derived(treeReorderAllowed({
    serverPaged: serverPage !== null,
    truncated: isTruncated,
    // The server's own continuation outranks count equality (#2162 LOCAL F1).
    continuation: !!serverPage && (serverPage.offset > 0 || !!serverPage.nextHref || !!serverPage.previousHref),
    serverResults: serverResults !== null,
    activeFilters: hasActiveFilters,
    hiddenUnshown: hasHiddenNodes && !showHidden,
  }));

  // The pool every pane shows. #706: this used to feed only NodeList while the
  // graph was built from `filteredNodes` — the pool BEFORE the hidden filter —
  // so record/system nodes rendered as graph nodes while being invisible in the
  // tree beside them. One derived value now answers "what is visible" for the
  // table and the graph; the tree gets `filteredNodes` and filters internally,
  // because it needs the unfiltered pool to decide whether hidden nodes exist
  // at all.
  //
  // The text match is server-side (#355), so there is no keyword filter here —
  // `filteredNodes` is already either the loaded set or the search results.
  const visibleNodes = $derived(
    showHidden ? filteredNodes : filteredNodes.filter((n) => !isHiddenNode(n))
  );
  // Retained name: NodeList and the search-rescue count below read this.
  const searchedNodes = $derived(visibleNodes);

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
    const urns = new Set(filteredNodes.map((n) => memoryIdentity(n)?.urn).filter(Boolean));
    return urns.size === 1 ? [...urns][0] : undefined;
  });
  // #706: the graph is built from `visibleNodes`, not `filteredNodes` — it was
  // the one pane that never applied the hidden filter, so a record/system node
  // appeared as a graph node while being absent from the tree beside it.
  const rawGraphViewData = $derived(buildGraphViewData(visibleNodes, singleMemoryUrn));
  // The tree deliberately still gets the UNFILTERED pool: TreeView applies the
  // hidden filter itself (and keeps virtual folders regardless), so handing it
  // `visibleNodes` would filter the same nodes twice and, worse, hide the
  // folders whose only children are hidden — which is what makes "Show hidden"
  // reveal something rather than nothing.
  const treeEntries = $derived.by(() => {
    const entries = buildTreeEntries(filteredNodes, singleMemoryUrn);
    if (searchDeletedIds.length === 0) return entries;
    const deleted = new Set(searchDeletedIds);
    return entries.map((e) => (e.nodeId && deleted.has(e.nodeId) ? { ...e, deleted: true } : e));
  });

  // Color rules: multiple memories → color by memory; multiple selected types → color by type; otherwise same color
  const graphViewData = $derived.by(() => {
    const gv = rawGraphViewData;
    // #706: `visibleNodes` throughout this derivation, matching what the graph
    // actually renders. On `filteredNodes` a hidden node still voted — it could
    // tip `hasMultiMemory` on for a memory with nothing visible in it, and
    // `locToType` could colour a FOLDER by the type of a node not on screen.
    const memoryUrns = [...new Set(visibleNodes.map((n) => memoryIdentity(n)?.urn ?? ''))].filter(Boolean);
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

    for (const n of visibleNodes) {
      idToType[n.id] = n.nodeType ?? 'info';
      idToMemory[n.id] = memoryIdentity(n)?.name ?? memoryIdentity(n)?.urn ?? '';
      locToType[n.loc] = n.nodeType ?? 'info';
      locToMemory[n.loc] = memoryIdentity(n)?.name ?? memoryIdentity(n)?.urn ?? '';
      if (readOnly || writableSet.size > 0) {
        idToReadOnly[n.id] = readOnly || !writableSet.has(n.memoryId);
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
    const urns = [...new Set(nodes.map((n) => memoryIdentity(n)?.urn ?? ''))];
    urns.forEach((u, i) => { map[u] = memoryColors[i % memoryColors.length]; });
    return map;
  });

  // Memory name lookup + read-only status by URN
  const memoryNameMap = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const row of scopeMemories) map[row.memoryUrn] = row.name;
    for (const n of nodes) {
      if (memoryIdentity(n)?.urn && memoryIdentity(n)!.name) map[memoryIdentity(n)!.urn] = memoryIdentity(n)!.name;
    }
    return map;
  });
  const memoryReadOnlyMap = $derived.by(() => {
    if (writableSet.size === 0) return {} as Record<string, boolean>;
    const map: Record<string, boolean> = {};
    for (const n of nodes) {
      if (memoryIdentity(n)?.urn) map[memoryIdentity(n)!.urn] = !writableSet.has(n.memoryId);
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
    {#if showTypeFilter}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('type')} disabled={refinementsOff}
          aria-describedby={refinementHintId}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50
            {activeNodeTypes.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Node Types {#if activeNodeTypes.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeNodeTypes.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'type' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'type' && !refinementsOff}
          <div class="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeNodeTypes.size > 0}
              <button onclick={() => { activeNodeTypes = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#if serverPage}
              <p class="px-2 pb-1 text-[10px] leading-tight text-zinc-400">{t('memory-browser.type-suggestions', 'Suggestions from this page. Add a content type to filter the whole scope.')}</p>
              <div class="mb-1 flex gap-1 px-1 pb-1">
                <input
                  type="text"
                  bind:value={customNodeType}
                  aria-label={t('memory-browser.custom-type-label', 'Add a node type')}
                  placeholder={t('memory-browser.custom-type-placeholder', 'Add type…')}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomNodeType(); } }}
                  class="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                />
                <button type="button" onclick={addCustomNodeType} class="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">{t('memory-browser.add-filter', 'Add')}</button>
              </div>
              {#if nodeTypeFilterError}
                <p class="px-2 pb-1 text-[10px] leading-tight text-amber-700 dark:text-amber-300">{nodeTypeFilterError}</p>
              {/if}
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
    {#if showTagsFilter}
      <div class="relative filter-dropdown">
        <button onclick={() => toggleDropdown('tags')} disabled={refinementsOff}
          aria-describedby={refinementHintId}
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50
            {activeTags.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
          Tags {#if activeTags.size > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{activeTags.size}</span>{/if}
          <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'tags' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
        </button>
        {#if openDropdown === 'tags' && !refinementsOff}
          <div class="absolute left-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {#if activeTags.size > 0}
              <button onclick={() => { activeTags = new Set(); }} class="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
            {/if}
            {#if serverPage}
              <p class="px-2 pb-1 text-[10px] leading-tight text-zinc-400">{t('memory-browser.tag-suggestions', 'Suggestions from this page. Add any tag to filter the whole scope, one tag at a time.')}</p>
              <div class="mb-1 flex gap-1 px-1 pb-1">
                <input
                  type="text"
                  bind:value={customTag}
                  aria-label={t('memory-browser.custom-tag-label', 'Add a tag')}
                  placeholder={t('memory-browser.custom-tag-placeholder', 'Add tag…')}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
                  class="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                />
                <button type="button" onclick={addCustomTag} class="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">{t('memory-browser.add-filter', 'Add')}</button>
              </div>
            {/if}
            {#each availableTags as t}
              <label class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
                <input type={serverPage ? 'radio' : 'checkbox'} name={serverPage ? tagGroupName : undefined} checked={activeTags.has(t)} onchange={() => toggleTag(t)}
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

    <!-- #589 (server #719/#725): structured query over properties/data —
         objectType facet, where predicate, sort-by-property. -->
    <div class="relative filter-dropdown">
      <button type="button" onclick={() => toggleDropdown('properties')}
        title="Filter and sort by structured properties"
        class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
          {structuredActiveCount > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600'}">
        Properties {#if structuredActiveCount > 0}<span class="rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{structuredActiveCount}</span>{/if}
        <svg width="10" height="10" viewBox="0 0 10 10" class="transition-transform {openDropdown === 'properties' ? 'rotate-180' : ''}"><path d="M2 4 L5 7 L8 4" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      </button>
      {#if openDropdown === 'properties'}
        <div class="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
          {#if structuredActiveCount > 0}
            <button type="button" onclick={clearStructuredFilters}
              class="w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800">Clear</button>
          {/if}

          <!-- Collection facet (filter.objectType) -->
          <div>
            <label for="structured-object-type" class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Object type</label>
            {#if collectionNames.length > 0}
              <!-- onchange: re-run the cast auto-pick — switching collections
                   can change the selected sort field's declared type. -->
              <select id="structured-object-type" bind:this={collectionControl} bind:value={objectTypeFilter} onchange={() => { changeCollection(); syncSortCastFromSchema(); }}
                class="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
                <option value="">Any</option>
                {#each collectionNames as name (name)}
                  <option value={name}>{name}</option>
                {/each}
              </select>
            {:else}
              <input id="structured-object-type" bind:this={collectionControl} type="text" bind:value={objectTypeFilter} oninput={() => changeCollection(true)} placeholder="e.g. competitor"
                class="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-500" />
            {/if}
          </div>

          <!-- Outside the keyed editor: collection changes must update an existing live region. -->
          <p role="status" aria-live="polite" aria-atomic="true" data-testid="property-filter-status" class="min-h-4 text-xs text-zinc-500 dark:text-zinc-400">{propertyFilterStatus}</p>
          <!-- The builder and Advanced share the same applied where channel. -->
          {#key `${propertyMemoryScope}:${objectTypeFilter}:${propertyEditorVersion}`}
            <PropertyFilter
              collection={memorySchema && Object.hasOwn(memorySchema.objectTypes, objectTypeFilter) ? memorySchema.objectTypes[objectTypeFilter] : null}
              bind:value={whereJson}
              onstatus={(message) => propertyFilterStatus = message}
            />
          {/key}

          <!-- Property sort (sortProperty) — overrides the Sort dropdown -->
          <div>
            <label for="structured-sort-path" class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Sort by property <span class="font-normal text-zinc-400">(overrides the Sort dropdown)</span></label>
            <div class="flex items-center gap-1.5">
              <!-- oninput (not onchange): the debounced fetch effect reacts to
                   the path immediately, so the cast must sync before it fires
                   (PR #616 review). -->
              <input id="structured-sort-path" type="text" bind:value={sortPropPath}
                oninput={syncSortCastFromSchema}
                list={declaredFieldNames.length > 0 ? 'structured-field-suggestions' : undefined}
                placeholder="path, e.g. fundingUsd"
                class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-500" />
              <select bind:value={sortPropDir} aria-label="Sort direction"
                class="rounded-lg border border-zinc-300 bg-white px-1.5 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
            </div>
            <div class="mt-1.5 flex items-center gap-1.5">
              <select bind:value={sortPropField} aria-label="Sort column"
                class="rounded-lg border border-zinc-300 bg-white px-1.5 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
                <option value="properties">properties</option>
                <!-- Encrypted memory: data is ciphertext at rest — a sort over
                     it can't order anything meaningfully. -->
                <option value="data" disabled={memoryEncrypted}>data{memoryEncrypted ? ' (encrypted)' : ''}</option>
              </select>
              <select bind:value={sortPropAs} aria-label="Sort value type"
                class="rounded-lg border border-zinc-300 bg-white px-1.5 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="datetime">datetime</option>
                <option value="boolean">boolean</option>
              </select>
              <span class="text-[10px] text-zinc-400">missing values sort last</span>
            </div>
            {#if declaredFieldNames.length > 0}
              <datalist id="structured-field-suggestions">
                {#each declaredFieldNames as name (name)}
                  <option value={name}></option>
                {/each}
              </datalist>
            {/if}
          </div>

          {#if memoryEncrypted}
            <p class="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] leading-tight text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              This memory is encrypted: filters and sorts over the <span class="font-mono">data</span> column can't match
              (it's ciphertext at rest). <span class="font-mono">properties</span> is plaintext and works normally.
            </p>
          {/if}
        </div>
      {/if}
    </div>

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

    <!-- portal#1015: Content / Comments / All, applied by the server before ranking and the result cap -->
    <!-- portal#1174: a bare "Content" beside "Node Types" read as a second type filter; name what it is. One label wraps both so they never split across lines, and the select takes its accessible name from the visible word (an aria-label would override it, WCAG 2.5.3). -->
    <label class="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{t('memory-browser.scope-label', 'Show')}</span>
    <!-- Disabled controls may be omitted by assistive technology; the enabled
         Show select must also carry the visible explanation. -->
    <select value={contentScope} onchange={(event) => changeContentScope(event.currentTarget.value as ContentScope)} id="scope-filter" data-testid="scope-filter" aria-describedby={refinementHintId}
      class="rounded-lg border px-2 py-1.5 text-xs
        {contentScope !== 'CONTENT' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'}">
      <option value="CONTENT">{t('memory-browser.scope.content', 'Content')}</option>
      <option value="COMMENTS">{t('memory-browser.scope.comments', 'Comments')}</option>
      <option value="ALL">{t('memory-browser.scope.all', 'Content and comments')}</option>
    </select>
    </label>

    <!-- #992: approval and minting state (server-side findNodes filter) -->
    <select bind:value={approvalFilter} data-testid="approval-filter" aria-label={t('memory-browser.approval-filter', 'Filter by approval')} title={t('memory-browser.approval-filter', 'Filter by approval')}
      class="rounded-lg border px-2 py-1.5 text-xs
        {approvalFilter !== '' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'}">
      <option value="">{t('memory-browser.approval.any', 'Any approval')}</option>
      <option value="APPROVED">{t('memory-browser.approval.approved', 'Approved')}</option>
      <option value="SUPERSEDED">{t('memory-browser.approval.superseded', 'Changed since approval')}</option>
      <option value="NOT_APPROVED">{t('memory-browser.approval.not-approved', 'Not approved')}</option>
      <!-- portal#1088 (hadron-server#1637): every node of an encrypted memory, and only those. -->
      <option value="NOT_APPLICABLE">{t('memory-browser.approval.not-applicable', 'Not applicable (encrypted memory)')}</option>
    </select>
    <select bind:value={mintedFilter} data-testid="minted-filter" aria-label={t('memory-browser.minted-filter', 'Filter by minting')} title={t('memory-browser.minted-filter', 'Filter by minting')}
      class="rounded-lg border px-2 py-1.5 text-xs
        {mintedFilter !== 'any' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'}">
      <option value="any">{t('memory-browser.minted.any', 'Minted or not')}</option>
      <option value="minted">{t('memory-browser.minted.minted', 'Minted')}</option>
      <option value="unminted">{t('memory-browser.minted.unminted', 'Not minted')}</option>
    </select>

    <!-- #429: Sort (server-side for updatedAt/relevance; loc is the browse default) -->
    <select bind:value={sortMode} title="Sort order"
      onchange={(e) => persistSortChoice(e.currentTarget.value)}
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
      {#if !forcedView && !commentsInView}
        <div
          role="group"
          aria-label={t('memory-browser.view-toggle-label', 'Browser view')}
          class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        >
          <button
            type="button"
            onclick={() => storedView = 'graph'}
            aria-pressed={activeView === 'graph'}
            class="px-2.5 py-1 text-xs {activeView === 'graph' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Graph</button>
          <button
            type="button"
            onclick={() => storedView = 'nodes'}
            aria-pressed={activeView === 'nodes'}
            class="px-2.5 py-1 text-xs {activeView === 'nodes' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Nodes</button>
        </div>
      {/if}
      <!-- #706: OUTSIDE the nodes-view gate. This control used to be
           nodes-only, which was right while the graph ignored the hidden
           filter — there was nothing to reveal there. Now that the graph
           honours it, gating the toggle to one view would make the graph
           consistent and its hidden nodes unreachable: filtered out, with no
           control in sight. Found by driving the graph pane, not by a test. -->
      {#if hasHiddenNodes}
        <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer">
          <input type="checkbox" bind:checked={showHidden}
            class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
          {t('memory-browser.show-hidden', 'Show hidden')}
        </label>
      {/if}
      {#if activeView === 'nodes' && !commentsInView}
        <div
          role="group"
          aria-label={t('memory-browser.nodes-pane-label', 'Nodes layout')}
          class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        >
          <button
            type="button"
            onclick={() => nodesPane = 'tree'}
            aria-pressed={nodesPane === 'tree'}
            class="px-2.5 py-1 text-xs {nodesPane === 'tree' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Tree</button>
          <button
            type="button"
            onclick={() => nodesPane = 'table'}
            aria-pressed={nodesPane === 'table'}
            class="px-2.5 py-1 text-xs {nodesPane === 'table' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
          >Table</button>
        </div>
      {/if}
      <span class="text-xs text-zinc-400">
        {#if serverResults !== null}{searchedNodes.length} result{searchedNodes.length === 1 ? '' : 's'}{:else}{searchedNodes.length}{searchedNodes.length !== displayTotal ? ` / ${displayTotal}` : ''}{/if}
      </span>
    </div>
    {#if refinementHintShown}
      <p id={REFINEMENT_HINT_ID} class="basis-full text-xs leading-snug text-zinc-500 dark:text-zinc-400">{t('memory-browser.refinement-content-only-hint', 'Node Types and Tags filter content, not comments. Your selections are kept for Content.')}</p>
    {/if}
  </div>

  <!-- Search status: server error (red) or a degrade note (amber, e.g. fuzzy
       with no vector index → "try Exact"). -->
  {#if serverResults !== null && (searchError || searchNote)}
    <div class="text-xs {searchError ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}">
      {searchError ?? searchNote}
      {#if !searchError && searchNeedsIndex && !multiMemory && basePath}
        <a class="underline" href={`${basePath}/settings#vector-index`}>{t('search.vector-settings', 'Open vector index settings')}</a>
      {/if}
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

  <!-- A capped or server-paged browse window is not the whole set — say so.
       On a server-paged App, Memory/type/tag filters and text search use the
       server across the full authorized scope; the unfiltered tree/graph stay local. -->
  {#if serverResults === null && isTruncated}
    <div class="text-xs text-amber-600 dark:text-amber-400">
      {#if serverPage}
        {t(
          'memory-browser.paged-notice',
          'Showing {loaded} nodes on this page of {total}. Filters and search cover the whole scope; the tree and graph show this page. Reordering is unavailable while paged.',
          { loaded: nodes.length.toLocaleString(), total: displayTotal.toLocaleString() },
        )}
      {:else}
        {t(
          'memory-browser.truncated-notice',
          'Showing the first {loaded} of {total} nodes. The type/tag filters and the tree/graph reflect only this loaded set; the search box covers the whole memory.',
          { loaded: nodes.length.toLocaleString(), total: (nodesTotal ?? 0).toLocaleString() },
        )}
      {/if}
    </div>
  {/if}

  <!-- Main area. Shared height is a CSS variable so the scrolling panes inherit
       one value (NodeList reads --memory-browser-h to bound its own scroll).
       Per code-review feedback on PR #211.

       #747: the `dvh` value is a DUPLICATED DIRECT DECLARATION, and the 320px
       is repeated rather than routed through the variable. That looks like
       something to tidy up and must not be.

       The custom property holds the `vh` value ONLY. Declaring `dvh` into the
       variable instead — `--memory-browser-h: calc(100vh …); --memory-browser-h:
       calc(100dvh …)` — silently breaks the fallback, because custom properties
       are not validated at declaration time: the second wins unconditionally,
       and on a browser without `dvh` the later `var()` substitution is invalid
       AT COMPUTED-VALUE TIME. That does not fall back to the previous
       declaration — it falls back to the property's INITIAL value, so the
       constraint disappears and the pane collapses.

       Measured in-browser rather than reasoned about, substituting a definitely
       unsupported unit for dvh:

         --h: calc(100vh - 320px); --h: calc(100qq - 320px); min-height: var(--h)
           → min-height computes to 0px          (constraint lost)
         --h: calc(100vh - 320px); min-height: var(--h); min-height: calc(100qq - 320px)
           → min-height computes to 400px        (bad declaration dropped at parse)

       A duplicated DIRECT declaration is dropped at parse time when the unit is
       unknown, which is what makes it a real fallback. Caught by Copilot on
       PR #753. -->
  {#if nodes.length === 0 && serverResults === null}
    <div class="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style="min-height: 400px;">
      No nodes to display.
    </div>
  {:else if activeView === 'graph' && displayNodes.length > 0}
    <!-- Graph view: the tree stays as a navigation sidebar beside the graph —
         a complementary representation, not a duplicate of the table. -->
    <!-- #747: below `sm` in the viewport-decided state the row becomes a
         COLUMN, so the "Tree ›" affordance sits ABOVE the graph instead of
         beside it. Hiding the tree alone was not enough — the button still held
         a place in the row and cost ~125px of a 390px viewport, which is a
         third of the screen spent on a control, with a dead gutter beside it.
         Only the `null` state stacks: an explicit open/close keeps the row it
         has always had at every width. -->
    <div
      class="flex gap-0 {treeOpen === null ? 'flex-col sm:flex-row' : ''}"
      style="--memory-browser-h: calc(100vh - 320px); min-height: var(--memory-browser-h); min-height: calc(100dvh - 320px);"
    >
      {#if treeOpen !== false}
        <!-- `max-width: 100%` alongside the dragged pixel width: the drag
             clamps to 500px, which is wider than a phone, so an explicitly
             opened tree would otherwise push the graph off the row entirely. -->
        <aside
          class="shrink-0 overflow-y-auto rounded-l-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 {treeOpen ===
          null
            ? 'hidden sm:block'
            : ''}"
          style="width: {treeWidth}px; max-width: 100%; max-height: var(--memory-browser-h); max-height: calc(100dvh - 320px);"
        >
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
          <TreeView entries={treeEntries} {basePath} nodeHrefFn={basePath ? undefined : treeNodeHrefFn} onselect={handleTreeSelect} onmove={handleTreeMove} onreorder={reorderSafe ? handleTreeReorder : undefined} bind:showHidden />
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- Hidden with the tree it resizes. It is also mouse-only
             (`onmousedown`), so it does nothing on touch either way. -->
        <div
          class="w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-indigo-400 transition-colors dark:bg-zinc-800 dark:hover:bg-indigo-500 {treeOpen ===
          null
            ? 'hidden sm:block'
            : ''}"
          class:bg-indigo-400={dragging}
          class:dark:bg-indigo-500={dragging}
          onmousedown={startDrag}
        ></div>
      {/if}
      <!-- The complement of the tree above, as two independent {#if}s rather
           than one if/else: in the `null` state BOTH are in the DOM and the
           breakpoint picks. `hidden` is display:none, so the loser leaves the
           accessibility tree too rather than merely the screen. -->
      {#if treeOpen !== true}
        <button
          onclick={() => treeOpen = true}
          class="mr-2 self-start rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 {treeOpen ===
          null
            ? 'sm:hidden'
            : ''}"
          title="Show tree"
        >
          Tree &rsaquo;
        </button>
      {/if}

      <!-- Which corners are rounded follows whether the tree is actually
           DISPLAYED, so in the `null` state it has to be a breakpoint too — a
           plain truthiness test reads null as "closed" and rounds the left edge
           where it sits flush against the tree. `rounded-lg` sets all four, so
           the sm: override has to undo the left pair explicitly. -->
      <div
        class="min-w-0 flex-1 overflow-hidden border border-zinc-200 dark:border-zinc-800 {treeOpen ===
        true
          ? 'rounded-r-lg'
          : treeOpen === false
            ? 'rounded-lg'
            : 'rounded-lg sm:rounded-l-none sm:rounded-r-lg'}"
      >
        <!-- Percentage height cannot resolve against the outer min-height.
             Give vis-network a definite canvas frame before its initial fit. -->
        <div data-testid="graph-canvas-frame" style="display: flex; height: var(--memory-browser-h); height: calc(100dvh - 320px); min-height: 400px;">
          <!-- resultsVersion (#616): re-mount when the server working set
               changes, even at the same size — see setServerResults.
               showHidden (#706): TopicGraph builds its vis datasets ONCE, in
               onMount, and its effects only flip `hidden` on ids that already
               exist — so a node absent at mount can never appear. Toggling
               "Show hidden" changes `visibleNodes`, but NONE of the other key
               terms move: `filteredNodes.length` is the pool BEFORE the hidden
               filter, and resultsVersion only bumps on a server search. Without
               this term the count, tree and table update while the canvas keeps
               its old nodes. Same trap as #616, same file, caught by the same
               reviewer. -->
          {#key resultsVersion + ':' + filteredNodes.length + ':' + showHidden + ':' + [...activeMemoryUrns].join(',') + ':' + [...activeNodeTypes].join(',') + ':' + [...activeTags].join(',') + ':' + keyword}
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
      style="--memory-browser-h: calc(100vh - 320px); min-height: var(--memory-browser-h); min-height: calc(100dvh - 320px);">
      {#if nodesPane === 'tree' && !commentsInView}
        <div class="overflow-y-auto bg-zinc-50 dark:bg-zinc-950" style="max-height: var(--memory-browser-h); max-height: calc(100dvh - 320px);">
          {#if moveError}
            <p class="m-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {moveError}
              <button type="button" class="ml-1 font-semibold hover:underline" aria-label="Dismiss move error" title="Dismiss" onclick={() => (moveError = null)}>×</button>
            </p>
          {/if}
          <TreeView entries={treeEntries} {basePath} nodeHrefFn={basePath ? undefined : treeNodeHrefFn} onmove={handleTreeMove} onreorder={reorderSafe ? handleTreeReorder : undefined} bind:showHidden />
        </div>
      {:else}
        <div class="p-4">
          <!-- hideSearch: the single search box lives in MemoryBrowser now
               (issue #355 — was two boxes); NodeList's own box would be the
               redundant second field. -->
          <!-- portal#1346: embedding badges follow the browsed memory's vectorIndexEnabled. `memory` is
               single-memory pages only, so agent/app browsers (several memories) show none by design. -->
          <NodeList
            nodes={searchedNodes} {basePath} memoryUrn={singleMemoryUrn ?? ''} listKey={nodeListKey} hideSearch={true} snippets={searchSnippets} meta={searchMeta} deletedIds={searchDeletedIds}
            serverPaged={serverPage !== null && serverResults === null}
            showColumns embeddingEnabled={memory?.vectorIndexEnabled === true} onvisiblenodes={showColumnsFor} columnData={nodeColumns.rows} signingOffered={nodeColumns.signing !== false} columnsLoading={nodeColumns.loading} columnsFailed={nodeColumns.failed} onretrycolumns={() => void nodeColumns.retry()}
          />
        </div>
      {/if}
    </div>
  {/if}
  {#if serverPage && serverResults === null}
    <ListPageNav page={serverPage} label={pageLabel ?? t('memory-browser.node-pages', 'Node pages')} />
  {/if}
</div>
