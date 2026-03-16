import type { GraphNode, TreeEntry, Topic, FolderNode, HierEdge, GraphViewData } from './types';

/**
 * Build a flat list of TreeEntry objects from GraphNode[].
 * Synthesizes virtual folder nodes for intermediate paths that have no real node.
 */
export function buildTreeEntries(nodes: GraphNode[]): TreeEntry[] {
  const locSet = new Set(nodes.map((n) => n.loc));
  const entries: TreeEntry[] = [];
  const seen = new Set<string>();

  // Sort nodes by loc for consistent ordering
  const sorted = [...nodes].sort((a, b) => a.loc.localeCompare(b.loc));

  for (const n of sorted) {
    // Synthesize virtual parents that don't have a real node
    const parts = n.loc.split('.');
    for (let i = 1; i < parts.length; i++) {
      const ancestorLoc = parts.slice(0, i).join('.');
      if (!locSet.has(ancestorLoc) && !seen.has(ancestorLoc)) {
        seen.add(ancestorLoc);
        entries.push({
          id: ancestorLoc,
          name: parts[i - 1],
          hasActions: false,
          isVirtual: true,
        });
      }
    }

    if (!seen.has(n.loc)) {
      seen.add(n.loc);
      entries.push({
        id: n.loc,
        name: n.name || n.title,
        hasActions: n.isRunnable ?? false,
        isVirtual: false,
      });
    }
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Build GraphViewData from a flat list of GraphNode[] for the TopicGraph component.
 */
export function buildGraphViewData(nodes: GraphNode[]): GraphViewData {
  const locSet = new Set(nodes.map((n) => n.loc));
  const topics: Topic[] = [];
  const folderNodeMap = new Map<string, FolderNode>();
  const hierEdges: HierEdge[] = [];

  for (const n of nodes) {
    const parts = n.loc.split('.');
    const domain = parts[0];
    const depth = parts.length - 1;

    // Build topic
    const outgoing = n.outgoingEdges
      .filter((e) => locSet.has(e.target.loc))
      .map((e) => ({
        id: e.id,
        rel: e.label,
        loc: e.target.loc,
        name: e.target.name || e.target.title,
      }));

    topics.push({
      id: n.loc,
      name: n.name || n.title,
      depth,
      description: n.description ?? '',
      tags: n.tags,
      domain,
      nodes: outgoing,
    });

    // Build hierarchy edges (parent → child)
    if (parts.length > 1) {
      const parentLoc = parts.slice(0, -1).join('.');
      hierEdges.push({ from: parentLoc, to: n.loc });

      // Ensure intermediate folder nodes exist
      for (let i = 1; i < parts.length; i++) {
        const folderLoc = parts.slice(0, i).join('.');
        if (!locSet.has(folderLoc) && !folderNodeMap.has(folderLoc)) {
          folderNodeMap.set(folderLoc, {
            id: folderLoc,
            name: parts[i - 1],
            domain: parts[0],
            isDomain: i === 1,
          });
        }
      }
    }

    // Domain root folder node
    if (!folderNodeMap.has(domain) && !locSet.has(domain)) {
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
