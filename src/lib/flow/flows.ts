/**
 * Flow discovery (#483): derive an App's flows from existing graph data —
 * no schema marker needed. A flow ROOT is a runnable node with at least
 * one outgoing routing edge and no incoming one (mid-flow nodes are the
 * target of a `next*` edge; roots aren't). Derivation mirrors the walker
 * grammar via $lib/flow/routing.
 */

import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { isRoutingName, routingNameOf } from './routing';

export interface FlowGraphNode {
  id: string;
  memoryId: string;
  loc: string;
  name: string;
  isRunnable?: boolean | null;
  memory?: { urn: string } | null;
  outgoingEdges?: Array<{
    name: string | null;
    loc: string;
    target?: { id: string; loc: string; name: string } | null;
  }> | null;
  incomingEdges?: Array<{
    name: string | null;
    loc: string;
    source?: { id: string; loc: string; name: string } | null;
  }> | null;
}

export interface FlowSummary {
  entry: { id: string; memoryId: string; loc: string; name: string; urn: string };
  /** Routing branches leaving the entry node. */
  branchCount: number;
  /** Nodes reachable over routing edges, entry included (bounded walk). */
  stepCount: number;
}

/** Mirrors the runner's RUN_MAX_HOPS — a longer chain can't execute anyway. */
const WALK_CAP = 50;

function routingTargets(node: FlowGraphNode): string[] {
  return (node.outgoingEdges ?? [])
    .filter((e) => isRoutingName(routingNameOf(e, node.loc)) && e.target)
    .map((e) => e.target!.id);
}

function hasIncomingRouting(node: FlowGraphNode): boolean {
  return (node.incomingEdges ?? []).some(
    (e) => e.source != null && isRoutingName(routingNameOf(e, e.source.loc)),
  );
}

/**
 * The flows startable from `nodes` (an App's accessible nodes): one
 * summary per flow root, sorted by name. Targets outside the provided
 * set still count as steps but aren't expanded (best-effort — cross-
 * memory flows show a lower bound).
 */
export function flowRoots(nodes: ReadonlyArray<FlowGraphNode>): FlowSummary[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter(
    (n) => !!n.isRunnable && routingTargets(n).length > 0 && !hasIncomingRouting(n),
  );

  return roots
    .map((root) => {
      // Bounded BFS over routing edges; cycles are fine (visited set).
      const visited = new Set<string>([root.id]);
      const queue = [root.id];
      while (queue.length > 0 && visited.size < WALK_CAP) {
        const node = byId.get(queue.shift()!);
        if (!node) continue; // target outside the fetched set — counted, not expanded
        for (const targetId of routingTargets(node)) {
          if (visited.has(targetId) || visited.size >= WALK_CAP) continue;
          visited.add(targetId);
          queue.push(targetId);
        }
      }
      return {
        entry: {
          id: root.id,
          memoryId: root.memoryId,
          loc: root.loc,
          name: root.name || root.loc,
          urn: root.memory?.urn ? composeNodeUrn(root.memory.urn, root.loc) : root.loc,
        },
        branchCount: routingTargets(root).length,
        stepCount: visited.size,
      };
    })
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
}
