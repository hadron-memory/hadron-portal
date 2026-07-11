class GraphState {
  selectedNodeId = $state<string | null>(null);
  /** Shared search filter — drives both TreeView filtering and TopicGraph node visibility */
  searchFilter = $state('');
  /**
   * #531: locs matched by the server-backed content search (name + tags +
   * description + body), or null when no such search is active. TreeView scopes
   * to these instead of its local name/id-only substring match, so a tag/body-
   * only hit (e.g. searching "payment" for a node tagged `payments`) surfaces in
   * the tree — not just the table list.
   */
  searchResultLocs = $state<Set<string> | null>(null);
}

export const graphState = new GraphState();
