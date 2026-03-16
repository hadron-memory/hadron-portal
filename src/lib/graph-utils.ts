import type { GraphNode, TreeEntry, Topic, TopicNode, FolderNode, HierEdge, GraphViewData } from '$lib/types';

/** Build a flat list of tree entries from graph nodes. */
export function buildTreeEntries(nodes: GraphNode[]): TreeEntry[] {
  return nodes.map((n) => ({
    id: n.loc,
    name: n.name || n.title,
    hasActions: n.isRunnable ?? false,
    isVirtual: !n.content,
  }));
}

/** Build the graph-view data (topics, folder nodes, hierarchy edges) from graph nodes. */
export function buildGraphViewData(nodes: GraphNode[]): GraphViewData {
  const topics: Topic[] = [];
  const folderSet = new Map<string, FolderNode>();
  const hierEdges: HierEdge[] = [];
  const edgeSet = new Set<string>();

  for (const n of nodes) {
    const parts = n.loc.split('.');
    const domain = parts[0];

    topics.push({
      id: n.loc,
      name: n.name || n.title,
      depth: parts.length - 1,
      description: n.description ?? '',
      tags: n.tags,
      domain,
      nodes: n.outgoingEdges.map<TopicNode>((e) => ({
        id: e.id,
        rel: e.label,
        loc: e.target.loc,
        name: e.target.name,
      })),
    });

    let parentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const currentPath = parentPath ? `${parentPath}.${parts[i]}` : parts[i];

      if (!folderSet.has(currentPath)) {
        folderSet.set(currentPath, {
          id: currentPath,
          name: parts[i],
          domain,
          isDomain: i === 0,
        });
      }

      if (parentPath) {
        const key = `${parentPath}->${currentPath}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          hierEdges.push({ from: parentPath, to: currentPath });
        }
      }
      parentPath = currentPath;
    }

    if (parentPath) {
      const key = `${parentPath}->${n.loc}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        hierEdges.push({ from: parentPath, to: n.loc });
      }
    }
  }

  const folderNodes = Array.from(folderSet.values());

  return { topics, folderNodes, hierEdges };
}
