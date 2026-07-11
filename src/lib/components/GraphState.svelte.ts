class GraphState {
  selectedNodeId = $state<string | null>(null);
  /** Shared search filter — drives both TreeView filtering and TopicGraph node visibility */
  searchFilter = $state('');
  /**
   * #531: node PKs matched by the server-backed content search (name + tags +
   * description + body), or null when no such search is active. TreeView /
   * TopicGraph scope to these instead of their local name substring match, so a
   * tag/body-only hit (e.g. searching "payment" for a node tagged `payments`)
   * surfaces in the tree/graph — not just the table list. Keyed on the PK, not
   * the loc: both TreeEntry.nodeId and Topic.id are the PK, and PKs are immune to
   * the memory-URN-prefix loc normalization buildTreeEntries/buildGraphViewData
   * apply (which raw server locs would not match).
   */
  searchResultNodeIds = $state<Set<string> | null>(null);
}

export const graphState = new GraphState();
