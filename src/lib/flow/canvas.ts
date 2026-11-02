/**
 * Flow-canvas view model (#478 follow-up spike): turns fetched flow
 * nodes + their outgoing edges into a renderable graph — routing edges
 * annotated with the walker's firing order (via routingOrder, the
 * server-parity mirror), reference edges kept but visually secondary.
 *
 * Pure data → data so it can be unit-tested without a browser; the
 * Svelte Flow component maps this onto its own node/edge shapes.
 */

import { describeCondition } from '$lib/edge-conditions/describe';
import { deserialize } from '$lib/edge-conditions/serializer';
import { extractionSpecOf } from './fields';
import { outputFromNodeData } from './extraction';
import { isRoutingName, routingNameOf, routingOrder } from './routing';

export interface FlowCanvasNodeInput {
  id: string;
  loc: string;
  name: string;
  data?: unknown;
  /** Reference nodes are non-routing edge targets — shown, never walked. */
  kind: 'flow' | 'reference';
}

export interface FlowCanvasEdgeInput {
  id: string;
  name: string | null;
  loc: string;
  priority?: number | null;
  condition?: unknown;
  sourceId: string;
  /** Loc of the source node — routingNameOf derives unnamed edges from it. */
  sourceLoc: string;
  targetId: string;
}

/**
 * Display projection of `data.script.call` (cor:agt:010:04). Ships the tool
 * and the arg KEY names only — arg values may carry templated or literal
 * content and never reach the client (#1597).
 */
export interface FlowCanvasScript {
  tool: string | null;
  argKeys: string[];
  /** script together with tools/extractionSpec (even an empty list): the server refuses it at load. */
  bothBodies: boolean;
}

export interface FlowCanvasNode {
  id: string;
  loc: string;
  name: string;
  kind: 'flow' | 'reference';
  /** Flow node no routing edge points at — a possible flow entry. */
  isEntry: boolean;
  extractionFields: string[];
  tools: string[];
  outputWriteTo: string | null;
  script: FlowCanvasScript | null;
}

export interface FlowCanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'routing' | 'reference';
  /** Effective routing name (explicit or loc-derived); edge name for reference edges. */
  label: string;
  /** 1-based position in the walker's evaluation order (routing edges only). */
  position: number | null;
  isFallThrough: boolean;
  isUnreachable: boolean;
  /** Plain-English condition, or a compact JSON snippet when the UI grammar can't express it. */
  conditionText: string | null;
}

export interface FlowCanvasModel {
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
}

/**
 * Everything the canvas side panel (#510) needs to edit one edge: the
 * editable fields plus endpoint labels. RoutingEdgeLike-compatible so the
 * panel can feed a source node's edges straight into routingOrder.
 */
export interface FlowEdgeDetail {
  id: string;
  name: string | null;
  loc: string;
  priority: number | null;
  condition: unknown;
  sourceId: string;
  sourceLoc: string;
  sourceName: string;
  targetId: string;
  targetLoc: string;
  targetName: string;
}

function toolsOf(data: unknown): string[] {
  if (data == null || typeof data !== 'object') return [];
  const tools = (data as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return [];
  return tools.filter((t): t is string => typeof t === 'string');
}

function scriptOf(data: unknown): FlowCanvasScript | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.script === undefined || d.script === null) return null;
  const call = (d.script as { call?: { tool?: unknown; args?: unknown } } | null)?.call;
  const args = call?.args;
  const argKeys = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args) : [];
  return {
    tool: typeof call?.tool === 'string' && call.tool.length > 0 ? call.tool : null,
    argKeys,
    bothBodies: Array.isArray(d.tools) || Array.isArray(d.extractionSpec),
  };
}

const CONDITION_SNIPPET_MAX = 80;

/** Human text for a stored JSONLogic condition; null when it always fires. */
export function conditionTextOf(condition: unknown): string | null {
  if (condition == null) return null;
  const parsed = deserialize(condition);
  if (parsed.ok) return describeCondition(parsed.ui);
  const raw = JSON.stringify(condition) ?? '';
  return raw.length > CONDITION_SNIPPET_MAX ? `${raw.slice(0, CONDITION_SNIPPET_MAX - 1)}…` : raw;
}

export function buildFlowCanvas(
  nodes: readonly FlowCanvasNodeInput[],
  edges: readonly FlowCanvasEdgeInput[],
): FlowCanvasModel {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const kept = edges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));

  // Firing order is per source node — group, then annotate via routingOrder.
  const bySource = new Map<string, FlowCanvasEdgeInput[]>();
  for (const e of kept) {
    const list = bySource.get(e.sourceId);
    if (list) list.push(e);
    else bySource.set(e.sourceId, [e]);
  }

  const canvasEdges: FlowCanvasEdge[] = [];
  const routedTargets = new Set<string>();
  for (const [, sourceEdges] of bySource) {
    const sourceLoc = sourceEdges[0].sourceLoc;
    const ordered = routingOrder(sourceEdges, sourceLoc);
    const orderedById = new Map(ordered.map((entry) => [entry.edge.id, entry]));
    for (const e of sourceEdges) {
      const entry = orderedById.get(e.id);
      if (entry) {
        routedTargets.add(e.targetId);
        canvasEdges.push({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          kind: 'routing',
          label: entry.routingName,
          position: entry.position,
          isFallThrough: entry.isFallThrough,
          isUnreachable: entry.isUnreachable,
          conditionText: conditionTextOf(e.condition),
        });
      } else {
        canvasEdges.push({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          kind: 'reference',
          label: routingNameOf(e, sourceLoc),
          position: null,
          isFallThrough: false,
          isUnreachable: false,
          conditionText: null,
        });
      }
    }
  }

  const canvasNodes: FlowCanvasNode[] = nodes.map((n) => ({
    id: n.id,
    loc: n.loc,
    name: n.name,
    kind: n.kind,
    isEntry: n.kind === 'flow' && !routedTargets.has(n.id),
    extractionFields: extractionSpecOf(n.data).map((f) => f.field),
    tools: toolsOf(n.data),
    outputWriteTo: outputFromNodeData(n.data)?.writeTo ?? null,
    script: scriptOf(n.data),
  }));

  return { nodes: canvasNodes, edges: canvasEdges };
}

/** True when an edge routes — used by the loader to decide traversal. */
export function edgeRoutes(edge: { name: string | null; loc: string }, sourceLoc: string): boolean {
  return isRoutingName(routingNameOf(edge, sourceLoc));
}
