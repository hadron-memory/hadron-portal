import { gqlClient } from '$lib/server/api';
import { fetchGraph, reconstructNodes } from '$lib/server/memory-graph';
import type { Memory } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// portal#1433 (D2): the memory's whole node graph is drained HERE, in the layout
// of the `(browser)` route group that holds the Nodes and Graph tabs, and
// nowhere else. Every other memory route (node detail, new node, info,
// settings, assets …) sits outside the group and loads no graph; the 17 node
// plus 12 edge pages of the 32,920-node fixture are no longer paid on them.
//
// Costs, stated: leaving the group and coming back (Nodes -> a node -> Nodes)
// drains again, where the memory layout used to hold the list for the whole
// visit (R3, accepted by Ada in #48224). Nodes <-> Graph stays inside the
// group, so it keeps ONE mounted browser and does not drain twice.
export const load: LayoutServerLoad = async ({ params, locals, parent }) => {
  // The drain keys on the URL ref, not on the parent's memory, so it starts
  // alongside `parent()` rather than after it.
  const [{ graph }, graphData] = await Promise.all([parent(), fetchGraph(gqlClient(locals.token), params.id)]);
  const memory = graph as Memory;

  // A hadron-server error stays distinguishable from a genuinely empty memory
  // (the latter otherwise reads as a silent empty state — this masked the
  // spec-037 edges migration drift once).
  const nodesFailed = 'failed' in graphData;
  const graphNodes = nodesFailed ? [] : reconstructNodes(graphData.nodes, graphData.edges, memory);
  // #429: the server-reported full node count for this memory (memoryNodes
  // total). Now that we page to completion this equals memoryNodes.length, but
  // keep surfacing it so a future page-cap or partial load stays visible. Null
  // when the fetch failed.
  const nodesTotal = nodesFailed ? null : graphData.nodesTotal;

  return { graphNodes, nodesTotal, nodesFailed };
};
