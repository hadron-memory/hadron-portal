class GraphState {
  selectedNodeId = $state<string | null>(null);
  /** Shared search filter — drives both TreeView filtering and TopicGraph node visibility */
  searchFilter = $state('');
}

export const graphState = new GraphState();
