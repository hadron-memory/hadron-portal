<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/stores";
  import type { TreeEntry } from "$lib/types";
  import { graphState } from "./GraphState.svelte.js";

  interface TreeNode {
    entry: TreeEntry;
    children: TreeNode[];
  }

  let {
    entries,
    basePath,
    hideSearch = false,
    nodeHrefFn,
    onmove,
    onreorder,
    showHidden = $bindable(false),
  }: {
    entries: TreeEntry[];
    basePath: string;
    hideSearch?: boolean;
    nodeHrefFn?: (entry: TreeEntry) => string | null;
    onmove?: (fromLoc: string, newParentLoc: string) => void;
    onreorder?: (parentLoc: string, orderedLocs: string[]) => void;
    /** When true, include record and system nodes in the tree. Bindable
     *  so MemoryBrowser can keep TreeView and NodeList in sync. */
    showHidden?: boolean;
  } = $props();

  // Use shared search state so graph can react to the same filter
  let search = $derived(graphState.searchFilter);
  // Alias retained so existing template bindings keep working.
  let showRecords = $derived(showHidden);

  // Filter entries: exclude record nodes by default, apply search
  let filteredEntries = $derived.by(() => {
    // First filter out record nodes unless toggled on
    const hiddenTypes = new Set(['record', 'system']);
    let pool = showRecords ? entries : entries.filter((e) => !hiddenTypes.has(e.nodeType) || e.isVirtual);

    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    const matching = pool.filter(
      (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
    // Include ancestors of matching entries
    const ids = new Set(matching.map((e) => e.id));
    for (const entry of matching) {
      const parts = entry.id.split(":");
      for (let i = 1; i < parts.length; i++) {
        ids.add(parts.slice(0, i).join(":"));
      }
    }
    return pool.filter((e) => ids.has(e.id));
  });

  const hasHiddenNodes = $derived(entries.some((e) => e.nodeType === 'record' || e.nodeType === 'system'));

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
    const id = activeNodeId;
    if (!id) return;
    const parts = id.split(":");
    for (let i = 1; i < parts.length; i++) {
      const ancestorId = parts.slice(0, i).join(":");
      if (!isExpanded(ancestorId)) {
        expanded[ancestorId] = true;
      }
    }
    tick().then(() => {
      const el = document.querySelector(`.tree-row[data-node-id="${id}"]`);
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
    return activeNodeId === entry.id;
  }

  function isMatch(entry: TreeEntry): boolean {
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

{#if !hideSearch}
  <div class="tree-search">
    <input
      type="text"
      class="search-input"
      placeholder="Filter..."
      value={search}
      oninput={(e) => graphState.searchFilter = e.currentTarget?.value ?? ''}
    />
    {#if search}
      <button class="search-clear" onclick={() => graphState.searchFilter = ''} aria-label="Clear search">&times;</button>
    {/if}
  </div>
  {#if hasHiddenNodes}
    <label class="record-toggle">
      <input type="checkbox" bind:checked={showHidden} />
      <span>Records</span>
    </label>
  {/if}
{/if}

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
      <a {href} class="node-link" class:active class:match={isMatch(node.entry)}>
        <span class="dot" class:action-dot={node.entry.hasActions}></span>
        {node.entry.name}
      </a>
    {:else}
      <button class="node-label" class:active class:match={isMatch(node.entry)} onclick={() => toggle(node.entry.id)}>
        <span class="dot" class:virtual-dot={node.entry.isVirtual} class:action-dot={node.entry.hasActions}></span>
        {node.entry.name}
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
  .tree-search {
    padding: 8px 8px 4px;
    position: relative;
  }

  .search-input {
    width: 100%;
    padding: 6px 28px 6px 10px;
    background: white;
    border: 1px solid #d4d4d8;
    border-radius: 6px;
    color: #27272a;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  :global(.dark) .search-input {
    background: #161b22;
    border-color: #30363d;
    color: #c9d1d9;
  }

  .search-input:focus {
    border-color: #58a6ff;
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.15);
  }

  .search-input::placeholder {
    color: #a1a1aa;
  }

  :global(.dark) .search-input::placeholder {
    color: #484f58;
  }

  .search-clear {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    line-height: 1;
  }

  .search-clear:hover {
    color: #27272a;
  }

  :global(.dark) .search-clear { color: #8b949e; }
  :global(.dark) .search-clear:hover { color: #c9d1d9; }

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

  .record-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 14px 8px;
    font-size: 11px;
    color: #71717a;
    cursor: pointer;
  }

  :global(.dark) .record-toggle { color: #8b949e; }

  .record-toggle input {
    width: 12px;
    height: 12px;
  }
</style>
