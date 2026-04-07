import type { MemoryNode, TreeEntry, Topic, FolderNode, HierEdge, GraphViewData } from './types';

/**
 * Build a flat list of TreeEntry objects from MemoryNode[].
 * Synthesizes virtual folder nodes for intermediate paths that have no real node.
 * Uses node.id as the entry ID to avoid collisions across memories.
 */
export function buildTreeEntries(nodes: MemoryNode[]): TreeEntry[] {
  // For tree view, we still organize by loc hierarchy but use node.id as the entry ID.
  // When multiple nodes share a loc, each gets its own entry with a unique ID.
  const locSet = new Set(nodes.map((n) => n.loc));
  const entries: TreeEntry[] = [];
  const seenVirtual = new Set<string>();

  // Sort by loc for consistent ordering
  const sorted = [...nodes].sort((a, b) => a.loc.localeCompare(b.loc));

  for (const n of sorted) {
    // Synthesize virtual parents that don't have a real node
    const parts = n.loc.split(':');
    for (let i = 1; i < parts.length; i++) {
      const ancestorLoc = parts.slice(0, i).join(':');
      if (!locSet.has(ancestorLoc) && !seenVirtual.has(ancestorLoc)) {
        seenVirtual.add(ancestorLoc);
        entries.push({
          id: ancestorLoc,
          nodeId: null,
          name: parts[i - 1],
          seq: null,
          hasActions: false,
          isVirtual: true,
        });
      }
    }

    entries.push({
      id: n.loc, // Tree uses loc for hierarchy — dedup handled below
      nodeId: n.id,
      name: n.name,
      seq: n.seq,
      hasActions: n.isRunnable ?? false,
      isVirtual: false,
    });
  }

  // Deduplicate entries by id (keep first occurrence)
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return deduped.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Build GraphViewData from a flat list of MemoryNode[] for the TopicGraph component.
 * Uses node.id (DB primary key) as the graph node ID to avoid collisions across memories.
 */
export function buildGraphViewData(nodes: MemoryNode[]): GraphViewData {
  const idSet = new Set(nodes.map((n) => n.id));
  const locToId = new Map<string, string>(); // loc → first node.id at that loc
  const topics: Topic[] = [];
  const folderNodeMap = new Map<string, FolderNode>();
  const hierEdges: HierEdge[] = [];

  // Build loc→id mapping (first node at each loc wins for folder edge targets)
  for (const n of nodes) {
    if (!locToId.has(n.loc)) locToId.set(n.loc, n.id);
  }

  for (const n of nodes) {
    const parts = n.loc.split(':');
    const domain = parts[0];
    const depth = parts.length - 1;

    // Build topic — outgoing edges reference target node IDs
    const outgoing = n.outgoingEdges
      .filter((e) => idSet.has(e.target.id))
      .map((e) => ({
        id: e.id,
        rel: e.label,
        loc: e.target.id, // use target's node.id as the graph reference
        name: e.target.name,
      }));

    const memoryUrn = n.memory?.urn ?? '';
    topics.push({
      id: n.id, // use DB primary key as graph node ID
      loc: n.loc,
      urn: memoryUrn ? `${memoryUrn}:${n.loc}` : n.loc,
      name: n.name,
      depth,
      description: n.description ?? '',
      tags: n.tags,
      domain,
      nodes: outgoing,
    });

    // Build hierarchy edges (parent folder → child node)
    if (parts.length > 1) {
      const parentLoc = parts.slice(0, -1).join(':');
      // Parent is either a real node (use its ID) or a folder node (use loc as ID)
      const parentId = locToId.get(parentLoc) ?? parentLoc;
      hierEdges.push({ from: parentId, to: n.id });

      // Ensure intermediate folder nodes exist
      for (let i = 1; i < parts.length; i++) {
        const folderLoc = parts.slice(0, i).join(':');
        if (!locToId.has(folderLoc) && !folderNodeMap.has(folderLoc)) {
          folderNodeMap.set(folderLoc, {
            id: folderLoc, // virtual folder uses loc as ID (no DB id)
            name: parts[i - 1],
            domain: parts[0],
            isDomain: i === 1,
          });
          // Add hier edge from grandparent to this folder
          if (i > 1) {
            const grandparentLoc = parts.slice(0, i - 1).join(':');
            const grandparentId = locToId.get(grandparentLoc) ?? grandparentLoc;
            hierEdges.push({ from: grandparentId, to: folderLoc });
          }
        }
      }
    }

    // Domain root folder node
    if (!folderNodeMap.has(domain) && !locToId.has(domain)) {
      folderNodeMap.set(domain, {
        id: domain,
        name: domain,
        domain,
        isDomain: true,
      });
    }
  }

  return {
    topics,
    folderNodes: [...folderNodeMap.values()],
    hierEdges,
  };
}
