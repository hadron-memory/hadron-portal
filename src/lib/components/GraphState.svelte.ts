class GraphState {
  selectedNodeId = $state<string | null>(null);
}

export const graphState = new GraphState();
