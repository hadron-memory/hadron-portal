<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/stores";
  import type { TreeEntry } from "$lib/types";
  import { graphState } from "./GraphState.svelte.js";

  interface TreeNode {
    entry: TreeEntry;
    children: TreeNode[];
  }

  let { entries, basePath }: { entries: TreeEntry[]; basePath: string } = $props();

  let search = $state("");

  // Filter entries when searching
  let filteredEntries = $derived.by(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    const matching = entries.filter(
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
    return entries.filter((e) => ids.has(e.id));
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
    if (entry.isVirtual) return null;
    return `${basePath}/nodes/${encodeURIComponent(entry.id)}`;
  }

  function isActive(entry: TreeEntry): boolean {
    return activeNodeId === entry.id;
  }

  function isMatch(entry: TreeEntry): boolean {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return entry.name.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q);
  }
</script>

<div class="tree-search">
  <input
    type="text"
    class="search-input"
    placeholder="Filter..."
    bind:value={search}
  />
  {#if search}
    <button class="search-clear" onclick={() => search = ""} aria-label="Clear search">&times;</button>
  {/if}
</div>

{#snippet nodeRow(node: TreeNode, depth: number)}
  {@const hasChildren = node.children.length > 0}
  {@const open = isExpanded(node.entry.id)}
  {@const href = nodeHref(node.entry)}
  {@const active = isActive(node.entry)}

  <div
    class="tree-row"
    class:active
    data-node-id={node.entry.id}
    style="padding-left: {depth * 16 + 4}px"
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
      <a {href} class="node-link" class:active class:match={isMatch(node.entry)} onclick={() => { if (hasChildren) toggle(node.entry.id); }}>
        {#if !node.entry.isVirtual}
          <span class="dot" class:action-dot={node.entry.hasActions}></span>
        {/if}
        {node.entry.name}
      </a>
    {:else}
      <button class="node-label" onclick={() => toggle(node.entry.id)}>
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
    color: #71717a;
    padding: 2px 6px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
  }

  :global(.dark) .node-label { color: #8b949e; }

  .node-label:hover {
    color: #27272a;
  }

  :global(.dark) .node-label:hover { color: #c9d1d9; }
</style>
