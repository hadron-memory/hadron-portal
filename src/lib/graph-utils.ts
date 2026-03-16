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
  const topics: Topic[] = nodes.map((n) => ({
    id: n.loc,
    name: n.name || n.title,
    depth: n.loc.split('.').length - 1,
    description: n.description ?? '',
    tags: n.tags,
    domain: n.loc.split('.')[0],
    nodes: n.outgoingEdges.map<TopicNode>((e) => ({
      id: e.id,
      rel: e.label,
      loc: e.target.loc,
      name: e.target.name,
    })),
  }));

  // Collect unique folder (namespace) nodes from loc segments
  const folderSet = new Map<string, FolderNode>();
  for (const n of nodes) {
    const parts = n.loc.split('.');
    let path = '';
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? `${path}.${parts[i]}` : parts[i];
      if (!folderSet.has(path)) {
        folderSet.set(path, {
          id: path,
          name: parts[i],
          domain: parts[0],
          isDomain: i === 0,
        });
      }
    }
  }
  const folderNodes = Array.from(folderSet.values());

  // Build hierarchy edges: parent folder → child folder, and deepest folder → leaf node
  const hierEdges: HierEdge[] = [];
  const edgeSet = new Set<string>();

  for (const n of nodes) {
    const parts = n.loc.split('.');
    // folder-to-folder edges
    let path = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const child = path ? `${path}.${parts[i]}` : parts[i];
      if (path) {
        const key = `${path}->${child}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          hierEdges.push({ from: path, to: child });
        }
      }
      path = child;
    }
    // folder → leaf node edge
    if (path) {
      const key = `${path}->${n.loc}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        hierEdges.push({ from: path, to: n.loc });
      }
    }
  }

  return { topics, folderNodes, hierEdges };
}
