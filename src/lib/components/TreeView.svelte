<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/stores";
  import type { TreeEntry } from "$lib/types";
  import { t } from "$lib/i18n/t";
  import { scopeTreeEntriesToSearch, withoutHiddenTreeEntries } from "$lib/graph-utils";
  import { isHiddenNodeType } from "$lib/node-types";
  import { graphState } from "./GraphState.svelte.js";

  interface TreeNode {
    entry: TreeEntry;
    children: TreeNode[];
  }

  let {
    entries,
    basePath,
    nodeHrefFn,
    onselect,
    onmove,
    onreorder,
    showHidden = $bindable(false),
  }: {
    entries: TreeEntry[];
    basePath: string;
    nodeHrefFn?: (entry: TreeEntry) => string | null;
    /** When set (the graph-view sidebar), a plain click on a real-node row
     *  calls this instead of navigating — so the click selects the node in
     *  the graph rather than opening its detail page (#349). */
    onselect?: (entry: TreeEntry) => void;
    onmove?: (fromLoc: string, newParentLoc: string) => void;
    onreorder?: (parentLoc: string, orderedLocs: string[]) => void;
    /** When true, include `HIDDEN_NODE_TYPES` nodes in the tree. Bindable so
     *  MemoryBrowser can keep all three panes in sync from its one toggle. */
    showHidden?: boolean;
  } = $props();

  // Use shared search state so graph can react to the same filter
  let search = $derived(graphState.searchFilter);
  // #531: node PKs matched by the server-backed content search. The single
  // search box lives in MemoryBrowser, so this is the only source.
  let searchResultNodeIds = $derived(graphState.searchResultNodeIds);

  // Filter entries: exclude hidden types by default, then scope to the active
  // search. #531: a server content search publishes matched node PKs
  // (searchResultNodeIds) that the tree scopes to — so a tag/body-only hit
  // surfaces here, not just in the table. See scopeTreeEntriesToSearch.
  //
  // A VIRTUAL entry is a synthesized folder, not a node with a type: it stays
  // while something visible sits under it (portal#1014: and only then, so a
  // folder of hidden comments doesn't show up empty).
  let filteredEntries = $derived.by(() => {
    const pool = showHidden ? entries : withoutHiddenTreeEntries(entries, isHiddenNodeType);
    return scopeTreeEntriesToSearch(pool, searchResultNodeIds, search);
  });

  // Build nested tree from flat sorted entries
  let tree = $derived.by(() => {
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const entry of filteredEntries) {
      const treeNode: TreeNode = { entry, children: [] };
      nodeMap.set(entry.id, treeNode);

      const dotIdx = entry.id.lastIndexOf(":");
      if (dotIdx === -1) {
        roots.push(treeNode);
      } else {
        const parentId = entry.id.substring(0, dotIdx);
        const parent = nodeMap.get(parentId);
        if (parent) {
          parent.children.push(treeNode);
        } else {
          roots.push(treeNode);
        }
      }
    }

    // Sort children: by seq first (if present), then alphabetically by id
    function sortChildren(nodes: TreeNode[]) {
      nodes.sort((a, b) => {
        const aSeq = a.entry.seq;
        const bSeq = b.entry.seq;
        if (aSeq !== null && bSeq !== null) return aSeq - bSeq;
        if (aSeq !== null) return -1;
        if (bSeq !== null) return 1;
        return a.entry.id.localeCompare(b.entry.id);
      });
      for (const n of nodes) sortChildren(n.children);
    }
    sortChildren(roots);

    return roots;
  });

  // Expand/collapse state: top-level nodes start expanded
  let expanded = $state<Record<string, boolean>>({});

  function isExpanded(id: string): boolean {
    if (search.trim()) return true;
    if (id in expanded) return expanded[id];
    return !id.includes(":");
  }

  function toggle(id: string) {
    expanded[id] = !isExpanded(id);
  }

  // Active node: from URL or graph selection
  let activeNodeId = $derived.by(() => {
    const path = $page.url.pathname;
    const nodesMatch = path.match(/\/nodes\/([^/]+)/);
    if (nodesMatch) return decodeURIComponent(nodesMatch[1]);
    return graphState.selectedNodeId;
  });

  // Auto-expand ancestors when active node changes
  $effect(() => {
    const sel = activeNodeId;
    if (!sel) return;
    // activeNodeId is a node PK (URL /nodes/<pk> or a graph selection); resolve
    // it to a loc — entries key loc as `id` and PK as `nodeId` — so we expand
    // the right loc-ancestors and the data-node-id (loc) scroll target matches.
    const loc = entries.find((e) => e.nodeId === sel)?.id ?? sel;
    const parts = loc.split(":");
    for (let i = 1; i < parts.length; i++) {
      const ancestorId = parts.slice(0, i).join(":");
      if (!isExpanded(ancestorId)) {
        expanded[ancestorId] = true;
      }
    }
    tick().then(() => {
      const el = document.querySelector(`.tree-row[data-node-id="${loc}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  });

  function nodeHref(entry: TreeEntry): string | null {
    if (entry.isVirtual || !entry.nodeId) return null;
    if (nodeHrefFn) return nodeHrefFn(entry);
    if (!basePath) return null;
    return `${basePath}/nodes/${entry.nodeId}`;
  }

  function isActive(entry: TreeEntry): boolean {
    const sel = activeNodeId;
    if (sel == null) return false;
    // activeNodeId is a node PK (URL /nodes/<pk> or a graph selection), while a
    // TreeEntry keys its loc as `id` and its PK as `nodeId`. Match on either so
    // the row lights up for graph/URL selections, not only loc-equal ids (#349).
    return sel === entry.nodeId || sel === entry.id;
  }

  // In the graph sidebar a plain click selects the node in the graph (opens its
  // popup) instead of navigating, mirroring a click on the node itself (#349).
  // Modifier / middle clicks fall through to the href so "open in new tab"
  // still works. With no onselect handler (the nodes-view tree, agent/app
  // pages) the link navigates as before.
  function handleRowActivate(e: MouseEvent, entry: TreeEntry) {
    if (!onselect) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onselect(entry);
  }

  function isMatch(entry: TreeEntry): boolean {
    // #531: highlight the server content-search hits when one drives the tree;
    // otherwise fall back to the local name/id match.
    if (searchResultNodeIds) return entry.nodeId != null && searchResultNodeIds.has(entry.nodeId);
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return entry.name.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q);
  }

  // ── Drag & drop ──────────────────────────────────────────────────────
  const canDrag = $derived(!!(onmove || onreorder));
  let dragId = $state<string | null>(null);
  let dropTarget = $state<{ id: string; position: 'before' | 'inside' | 'after' } | null>(null);

  function handleDragStart(e: DragEvent, entry: TreeEntry) {
    if (!canDrag || entry.isVirtual) { e.preventDefault(); return; }
    dragId = entry.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', entry.id);
  }

  function handleDragOver(e: DragEvent, entry: TreeEntry) {
    if (!dragId || dragId === entry.id) return;
    // Don't allow dropping onto own descendant
    if (entry.id.startsWith(dragId + ':')) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (y < h * 0.25) {
      dropTarget = { id: entry.id, position: 'before' };
    } else if (y > h * 0.75) {
      dropTarget = { id: entry.id, position: 'after' };
    } else {
      dropTarget = { id: entry.id, position: 'inside' };
    }
  }

  function handleDragLeave() {
    dropTarget = null;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    if (!dragId || !dropTarget) { dragId = null; dropTarget = null; return; }

    const draggedLoc = dragId;
    const targetLoc = dropTarget.id;
    const position = dropTarget.position;

    dragId = null;
    dropTarget = null;

    if (position === 'inside') {
      // Move dragged node to become a child of target
      if (onmove) onmove(draggedLoc, targetLoc);
    } else {
      // Reorder: dragged node moves to same parent as target, before or after it
      const targetParts = targetLoc.split(':');
      const targetParent = targetParts.length > 1 ? targetParts.slice(0, -1).join(':') : '';
      const draggedParts = draggedLoc.split(':');
      const draggedParent = draggedParts.length > 1 ? draggedParts.slice(0, -1).join(':') : '';

      if (draggedParent !== targetParent) {
        // Different parent — move first, then reorder
        if (onmove) onmove(draggedLoc, targetParent);
        // After move, the new loc will be targetParent:draggedName
        const draggedName = draggedParts[draggedParts.length - 1];
        const newDraggedLoc = targetParent ? `${targetParent}:${draggedName}` : draggedName;
        // Compute sibling order
        if (onreorder) {
          const siblings = getSiblingLocs(targetParent).filter((l) => l !== draggedLoc);
          const idx = siblings.indexOf(targetLoc);
          const insertIdx = position === 'before' ? idx : idx + 1;
          siblings.splice(insertIdx, 0, newDraggedLoc);
          onreorder(targetParent, siblings);
        }
      } else {
        // Same parent — just reorder
        if (onreorder) {
          const siblings = getSiblingLocs(targetParent);
          const filtered = siblings.filter((l) => l !== draggedLoc);
          const idx = filtered.indexOf(targetLoc);
          const insertIdx = position === 'before' ? idx : idx + 1;
          filtered.splice(insertIdx, 0, draggedLoc);
          onreorder(targetParent, filtered);
        }
      }
    }
  }

  function handleDragEnd() {
    dragId = null;
    dropTarget = null;
  }

  /** Get ordered loc IDs of direct children under a parent. */
  function getSiblingLocs(parentLoc: string): string[] {
    const parentNode = parentLoc ? tree.flatMap(function collect(n: TreeNode): TreeNode[] { return [n, ...n.children.flatMap(collect)]; }).find((n) => n.entry.id === parentLoc) : null;
    const siblings = parentNode ? parentNode.children : tree;
    return siblings.map((n) => n.entry.id);
  }
</script>

<!-- #706: TreeView rendered its own "Filter…" box and a `Records` checkbox
     behind `{#if !hideSearch}`. Both call sites passed `hideSearch={true}`, so
     neither had rendered for a long time, and MemoryBrowser's own comment
     already recorded why: the single search box and the single "Show hidden"
     toggle live in its filter bar. Removed with the prop rather than left as a
     control nobody can reach — a second toggle for one piece of state is how
     the panes disagreed in the first place. `search` and `showHidden` are still
     read; only the duplicate controls are gone. -->

{#snippet nodeRow(node: TreeNode, depth: number)}
  {@const hasChildren = node.children.length > 0}
  {@const open = isExpanded(node.entry.id)}
  {@const href = nodeHref(node.entry)}
  {@const active = isActive(node.entry)}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tree-row"
    class:active
    class:drop-before={dropTarget?.id === node.entry.id && dropTarget?.position === 'before'}
    class:drop-inside={dropTarget?.id === node.entry.id && dropTarget?.position === 'inside'}
    class:drop-after={dropTarget?.id === node.entry.id && dropTarget?.position === 'after'}
    class:dragging={dragId === node.entry.id}
    data-node-id={node.entry.id}
    style="padding-left: {depth * 16 + 4}px"
    draggable={canDrag && !node.entry.isVirtual ? 'true' : undefined}
    ondragstart={(e) => handleDragStart(e, node.entry)}
    ondragover={(e) => handleDragOver(e, node.entry)}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    ondragend={handleDragEnd}
  >
    <button
      class="chevron"
      class:invisible={!hasChildren}
      onclick={() => toggle(node.entry.id)}
      tabindex={hasChildren ? 0 : -1}
      aria-label={hasChildren ? (open ? "Collapse" : "Expand") : undefined}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" class:rotated={open}>
        <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
      </svg>
    </button>

    {#if href}
      <a {href} class="node-link" class:active class:match={isMatch(node.entry)}
        onclick={(e) => handleRowActivate(e, node.entry)}>
        <span class="dot" class:action-dot={node.entry.hasActions}></span>
        {node.entry.name}
        {#if node.entry.deleted}<span data-testid="node-deleted" class="deleted-badge">{t('node.deleted.badge', 'Deleted')}</span>{/if}
      </a>
    {:else}
      <button class="node-label" class:active class:match={isMatch(node.entry)} onclick={() => toggle(node.entry.id)}>
        <span class="dot" class:virtual-dot={node.entry.isVirtual} class:action-dot={node.entry.hasActions}></span>
        {node.entry.name}
        {#if node.entry.deleted}<span data-testid="node-deleted" class="deleted-badge">{t('node.deleted.badge', 'Deleted')}</span>{/if}
      </button>
    {/if}
  </div>

  {#if hasChildren && open}
    {#each node.children as child}
      {@render nodeRow(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<nav class="tree-view">
  {#each tree as root}
    {@render nodeRow(root, 0)}
  {/each}
  {#if search && tree.length === 0}
    <div class="no-results">No matches</div>
  {/if}
</nav>

<style>
  .no-results {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #71717a;
  }

  :global(.dark) .no-results { color: #8b949e; }

  .tree-view {
    padding: 4px 0 8px;
    font-size: 13px;
    line-height: 1;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    position: relative;
  }

  .tree-row.active {
    background: rgba(88, 166, 255, 0.08);
  }

  .tree-row.dragging {
    opacity: 0.4;
  }

  .tree-row.drop-before {
    box-shadow: inset 0 2px 0 0 #6366f1;
  }

  .tree-row.drop-inside {
    background: rgba(99, 102, 241, 0.15);
    border-radius: 4px;
  }

  .tree-row.drop-after {
    box-shadow: inset 0 -2px 0 0 #6366f1;
  }

  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    color: #a1a1aa;
    cursor: pointer;
    flex-shrink: 0;
    border-radius: 3px;
  }

  :global(.dark) .chevron { color: #484f58; }

  .chevron:hover {
    color: #52525b;
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .chevron:hover {
    color: #8b949e;
    background: rgba(255, 255, 255, 0.05);
  }

  .chevron.invisible {
    visibility: hidden;
  }

  .chevron svg {
    transition: transform 0.12s ease;
  }

  .chevron svg.rotated {
    transform: rotate(90deg);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #58a6ff;
    flex-shrink: 0;
  }

  .dot.action-dot {
    background: #3fb950;
  }

  /* Virtual (synthetic-folder) nodes have no backing node — hollow dot
   * keeps the visual cue that they aren't navigable while still matching
   * the bullet column of real nodes (issue #204). */
  /* #1161: a server-reported deleted node (Include deleted view). */
  .deleted-badge {
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid #f85149;
    border-radius: 4px;
    font-size: 10px;
    color: #f85149;
  }
  .dot.virtual-dot {
    background: transparent;
    border: 1px solid #58a6ff;
    width: 6px;
    height: 6px;
    box-sizing: border-box;
  }

  .node-link {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #27272a;
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.dark) .node-link { color: #c9d1d9; }

  .node-link:hover {
    color: #09090b;
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .node-link:hover {
    color: #f0f6fc;
    background: rgba(255, 255, 255, 0.05);
  }

  .node-link.active {
    color: #4f46e5;
    background: rgba(79, 70, 229, 0.1);
  }

  :global(.dark) .node-link.active {
    color: #f0f6fc;
    background: rgba(88, 166, 255, 0.15);
  }

  .node-link.match {
    color: #09090b;
  }

  :global(.dark) .node-link.match { color: #f0f6fc; }

  .node-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #27272a;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
  }

  :global(.dark) .node-label { color: #c9d1d9; }

  .node-label:hover {
    color: #09090b;
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .node-label:hover {
    color: #f0f6fc;
    background: rgba(255, 255, 255, 0.05);
  }

  .node-label.active {
    color: #4f46e5;
    background: rgba(79, 70, 229, 0.1);
  }

  :global(.dark) .node-label.active {
    color: #f0f6fc;
    background: rgba(88, 166, 255, 0.15);
  }

  .node-label.match {
    color: #09090b;
  }

  :global(.dark) .node-label.match { color: #f0f6fc; }
</style>
