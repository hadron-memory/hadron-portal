/**
 * Collect the envelope fields visible to a flow edge's condition, for
 * the condition builder's variable picker (#478 phase 1).
 *
 * A run walks node → extract (`data.extractionSpec`) → follow edge, so
 * by the time an outgoing edge's condition evaluates, the envelope
 * holds the SOURCE node's extracted fields plus everything upstream
 * flow nodes extracted before routing here. Conditions address them at
 * `message.data.<field>` (plan-multi-node D-MN-1).
 *
 * Upstream discovery is best-effort by design (the issue allows 1–2
 * levels): we walk incoming `next*` edges as deep as the caller's query
 * fetched them. Free-text entry stays available for anything missed.
 */

import type { KnownVariable } from '$lib/edge-conditions/known-variables';
import { isRoutingName, routingNameOf } from './routing';

export interface FlowFieldNode {
  loc: string;
  name: string;
  data?: unknown;
  incomingEdges?: Array<{
    name: string | null;
    loc: string;
    source?: FlowFieldNode | null;
  }> | null;
}

export interface ExtractionEntry {
  field: string;
  description?: string;
  shape?: string;
}

/** The `data.extractionSpec` entries of one node, shape-tolerantly. */
export function extractionSpecOf(data: unknown): ExtractionEntry[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const spec = (data as Record<string, unknown>).extractionSpec;
  if (!Array.isArray(spec)) return [];
  return spec.filter(
    (e): e is ExtractionEntry =>
      e !== null && typeof e === 'object' && typeof (e as ExtractionEntry).field === 'string',
  );
}

/**
 * Envelope-field picker entries for conditions on `node`'s outgoing
 * edges: the node's own extraction fields plus upstream flow nodes',
 * deduped by path (first writer wins — the label cites the nearest
 * extracting node).
 */
export function collectFlowFields(node: FlowFieldNode): KnownVariable[] {
  const out: KnownVariable[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();

  function addFrom(n: FlowFieldNode) {
    if (visited.has(n.loc)) return;
    visited.add(n.loc);
    for (const entry of extractionSpecOf(n.data)) {
      const path = `message.data.${entry.field}`;
      if (seen.has(path)) continue;
      seen.add(path);
      const shape = entry.shape && ['number', 'boolean', 'string[]'].includes(entry.shape)
        ? entry.shape
        : 'string';
      out.push({
        path,
        label: `${entry.field} — extracted by “${n.name || n.loc}” (${shape})`,
        hint: entry.description,
      });
    }
    for (const edge of n.incomingEdges ?? []) {
      if (!edge.source) continue;
      // Incoming edges are owned by their SOURCE node — derive the
      // routing name against that node's loc, exactly like the walker.
      if (!isRoutingName(routingNameOf(edge, edge.source.loc))) continue;
      addFrom(edge.source);
    }
  }

  addFrom(node);
  return out;
}

export interface FlowGraphNodeInput {
  id: string;
  loc: string;
  name: string;
  /** Already-extracted spec entries (extractionSpecOf), not raw node data. */
  extractionSpec: ExtractionEntry[];
}

export interface FlowGraphEdgeInput {
  name: string | null;
  loc: string;
  sourceId: string;
  targetId: string;
}

/**
 * Envelope-field picker entries for ONE node of an already-fetched flow
 * graph (the flow canvas's edge panel, #510): wires the nodes into a
 * FlowFieldNode object graph (cyclic references are fine —
 * collectFlowFields guards by loc; edges with an endpoint outside
 * `nodes` are skipped) and collects the node's fields from its full
 * upstream within the graph. Client-safe, so the canvas page computes
 * fields lazily for the one open panel instead of shipping a
 * precomputed O(nodes × upstream) label map on every load.
 */
export function collectFlowFieldsFor(
  nodeId: string,
  nodes: readonly FlowGraphNodeInput[],
  edges: readonly FlowGraphEdgeInput[],
): KnownVariable[] {
  const byId = new Map<string, FlowFieldNode>(
    nodes.map((n) => [
      n.id,
      { loc: n.loc, name: n.name, data: { extractionSpec: n.extractionSpec }, incomingEdges: [] },
    ]),
  );
  for (const e of edges) {
    const source = byId.get(e.sourceId);
    const target = byId.get(e.targetId);
    if (!source || !target) continue;
    target.incomingEdges!.push({ name: e.name, loc: e.loc, source });
  }
  const fieldNode = byId.get(nodeId);
  return fieldNode ? collectFlowFields(fieldNode) : [];
}
