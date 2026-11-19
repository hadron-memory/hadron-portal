/**
 * Conversation-canvas view model: turns an agent's system-memory nodes +
 * edges into a renderable graph for the chatbot conversation editor —
 * conversation group nodes containing their stages (ordered per the
 * conversation's data.stageOrder), topic nodes, implicit stage-sequence
 * edges, and the real routing-rule edges annotated with their evaluation
 * order (rules fire in priority order, first match wins — hrn:node:hadronmemory.com:specs:cor:cht:030:02).
 *
 * Pure data → data, like $lib/flow/canvas.ts, so it can be unit-tested
 * without a browser; ConversationCanvas.svelte maps this onto Svelte Flow
 * node/edge shapes (stages as child nodes of their conversation group).
 */

import { conditionTextOf } from './canvas';
import { extractionSpecOf } from './fields';
import { orderOrdinaryConversations } from './conversation-order';

export interface ConversationGraphNodeInput {
  id: string;
  loc: string;
  name: string;
  description?: string | null;
  /** The node's own URN, shown beside a rule's target (render-urn). */
  urn?: string | null;
  /** Start order (Q14): ascending, nulls last, ties by loc. Ordinary conversations only. */
  seq?: number | null;
  data?: unknown;
}

export interface ConversationGraphEdgeInput {
  id: string;
  name: string | null;
  sourceId: string;
  targetId: string;
  priority?: number | null;
  condition?: unknown;
  data?: unknown;
}

export interface ConversationGraphEdgeSourceInput {
  id: string;
  outgoingEdges?: Array<{
    id: string;
    name: string | null;
    target?: { id: string } | null;
    priority?: number | null;
    condition?: unknown;
    data?: unknown;
  }> | null;
}

export interface ConversationCanvasNode {
  id: string;
  loc: string;
  /** Display label: description (the human name) falls back to name/loc. */
  label: string;
  kind: 'conversation' | 'stage' | 'topic';
  /** Conversation node id for stages; null for top-level nodes. */
  parentId: string | null;
  /** Absolute for conversations/topics; relative to the parent for stages. */
  position: { x: number; y: number };
  width: number;
  height: number;
  isSetup: boolean;
  isFallback: boolean;
  /** 1-based place in the start order; null for setup, fallback, stages and topics (Q13). */
  startOrder: number | null;
  /** How many ordinary conversations share the start order; null where startOrder is. */
  startTotal: number | null;
  goalCount: number;
  /** 1-based slot in the conversation's stage sequence (stages only). */
  stageIndex: number | null;
  extractionFields: string[];
  promptRef: string | null;
}

export interface ConversationCanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** rule = real routing edge; sequence = implicit stageOrder succession. */
  kind: 'rule' | 'sequence';
  label: string;
  timing: string | null;
  isDetour: boolean;
  /** 1-based rank among the source's rules in priority order; null for a lone rule. */
  position: number | null;
  conditionText: string | null;
}

export interface ConversationCanvasModel {
  /** Parents precede children — the order Svelte Flow requires. */
  nodes: ConversationCanvasNode[];
  edges: ConversationCanvasEdge[];
}

/** Everything the edge side panel needs to edit one routing rule. */
export interface ConversationEdgeDetail {
  id: string;
  name: string | null;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  /** The target node's URN; null when the read did not carry one. */
  targetUrn: string | null;
  priority: number | null;
  condition: unknown;
  timing: string | null;
  behavior: string | null;
  /** The stored edge data, so a save can merge timing/behavior into it. */
  data: Record<string, unknown>;
}

// Layout constants (px). Defaults only — a node's persisted data.position
// (written by savePosition on drag) always wins.
export const STAGE_WIDTH = 200;
export const STAGE_HEIGHT = 88;
const STAGE_GAP = 28;
const GROUP_PAD_X = 16;
const GROUP_HEADER_HEIGHT = 60;
const GROUP_PAD_BOTTOM = 16;
const GROUP_MIN_WIDTH = 260;
const TOPIC_WIDTH = 200;
const TOPIC_HEIGHT = 60;
const COLUMN_GAP = 120;
const ROW_GAP = 56;

function dataOf(node: { data?: unknown }): Record<string, unknown> {
  return node.data != null && typeof node.data === 'object'
    ? (node.data as Record<string, unknown>)
    : {};
}

function savedPosition(data: Record<string, unknown>): { x: number; y: number } | null {
  const pos = data.position as { x?: unknown; y?: unknown } | undefined;
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    return { x: pos.x, y: pos.y };
  }
  return null;
}

function labelOf(node: ConversationGraphNodeInput): string {
  return node.description || node.name || node.loc;
}

export function conversationEdgeInputsFromNodes(
  nodes: readonly ConversationGraphEdgeSourceInput[],
): ConversationGraphEdgeInput[] {
  const edges: ConversationGraphEdgeInput[] = [];
  for (const n of nodes) {
    for (const e of n.outgoingEdges ?? []) {
      if (!e.target) continue;
      edges.push({
        id: e.id,
        name: e.name,
        sourceId: n.id,
        targetId: e.target.id,
        priority: e.priority ?? null,
        condition: e.condition ?? null,
        data: e.data ?? {},
      });
    }
  }
  return edges;
}

function segments(loc: string): string[] {
  return loc.split(':');
}

export function isConversationLoc(loc: string): boolean {
  return loc.startsWith('conversations:') && segments(loc).length === 2;
}

export function isStageLoc(loc: string): boolean {
  return loc.startsWith('conversations:') && segments(loc).length === 3;
}

export function isTopicLoc(loc: string): boolean {
  return loc.startsWith('topics:') && segments(loc).length === 2;
}

/**
 * A conversation's stages in effective order: data.stageOrder names first
 * (matched by trailing loc segment), then any stages the order doesn't
 * mention, by loc. The same order the runtime walks — used by the canvas
 * sequence edges and the conversation panel's stage list.
 */
export function orderedStages<T extends { loc: string }>(
  stageOrder: readonly string[],
  stages: readonly T[],
): T[] {
  const ordered: T[] = [];
  for (const slug of stageOrder) {
    const found = stages.find((s) => s.loc.endsWith(`:${slug}`));
    if (found && !ordered.includes(found)) ordered.push(found);
  }
  for (const s of [...stages].sort((a, b) => a.loc.localeCompare(b.loc))) {
    if (!ordered.includes(s)) ordered.push(s);
  }
  return ordered;
}

function timingOf(data: Record<string, unknown>): string | null {
  return typeof data.timing === 'string' && data.timing !== '' ? data.timing : null;
}

function behaviorOf(data: Record<string, unknown>): string | null {
  return typeof data.behavior === 'string' && data.behavior !== '' ? data.behavior : null;
}

export function buildConversationCanvas(
  nodes: readonly ConversationGraphNodeInput[],
  edges: readonly ConversationGraphEdgeInput[],
): ConversationCanvasModel {
  const topics = nodes.filter((n) => isTopicLoc(n.loc)).sort((a, b) => a.loc.localeCompare(b.loc));
  // Ordinary conversations first, in start order; setup and fallback follow by
  // loc and carry no number (Q13, Q14, Q14a).
  const allConversations = nodes.filter((n) => isConversationLoc(n.loc));
  const ordinary = orderOrdinaryConversations(allConversations);
  const startOrderByLoc = new Map(ordinary.map((c, i) => [c.loc, i + 1]));
  const conversations = [
    ...ordinary,
    ...allConversations
      .filter((n) => !startOrderByLoc.has(n.loc))
      .sort((a, b) => a.loc.localeCompare(b.loc)),
  ];
  const stagesByConv = new Map<string, ConversationGraphNodeInput[]>();
  for (const n of nodes) {
    if (!isStageLoc(n.loc)) continue;
    const convLoc = segments(n.loc).slice(0, 2).join(':');
    const list = stagesByConv.get(convLoc);
    if (list) list.push(n);
    else stagesByConv.set(convLoc, [n]);
  }

  const canvasNodes: ConversationCanvasNode[] = [];

  let topicY = 0;
  for (const t of topics) {
    const data = dataOf(t);
    canvasNodes.push({
      id: t.id,
      loc: t.loc,
      label: labelOf(t),
      kind: 'topic',
      parentId: null,
      position: savedPosition(data) ?? { x: 0, y: topicY },
      width: TOPIC_WIDTH,
      height: TOPIC_HEIGHT,
      isSetup: false,
      isFallback: false,
      startOrder: null,
      startTotal: null,
      goalCount: 0,
      stageIndex: null,
      extractionFields: [],
      promptRef: null,
    });
    topicY += TOPIC_HEIGHT + 24;
  }

  const conversationX = topics.length > 0 ? TOPIC_WIDTH + COLUMN_GAP : 0;
  let conversationY = 0;
  for (const conv of conversations) {
    const convData = dataOf(conv);
    const stageOrder = Array.isArray(convData.stageOrder)
      ? (convData.stageOrder as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const stages = orderedStages(stageOrder, stagesByConv.get(conv.loc) ?? []);

    // Default slot per stage; a stage's own saved position overrides it, and
    // the group grows to keep every saved position inside its extent.
    const stageNodes: ConversationCanvasNode[] = stages.map((stage, i) => {
      const stageData = dataOf(stage);
      return {
        id: stage.id,
        loc: stage.loc,
        label: labelOf(stage),
        kind: 'stage' as const,
        parentId: conv.id,
        position: savedPosition(stageData) ?? {
          x: GROUP_PAD_X + i * (STAGE_WIDTH + STAGE_GAP),
          y: GROUP_HEADER_HEIGHT,
        },
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        isSetup: false,
        isFallback: false,
        startOrder: null,
        startTotal: null,
        goalCount: 0,
        stageIndex: i + 1,
        extractionFields: extractionSpecOf(stage.data).map((f) => f.field),
        promptRef: typeof stageData.promptRef === 'string' ? stageData.promptRef : null,
      };
    });

    let width = GROUP_MIN_WIDTH;
    let height = GROUP_HEADER_HEIGHT + GROUP_PAD_BOTTOM + (stageNodes.length > 0 ? STAGE_HEIGHT : 0);
    for (const s of stageNodes) {
      width = Math.max(width, s.position.x + STAGE_WIDTH + GROUP_PAD_X);
      height = Math.max(height, s.position.y + STAGE_HEIGHT + GROUP_PAD_BOTTOM);
    }

    const goals = Array.isArray(convData.goalDescriptions) ? convData.goalDescriptions : [];
    canvasNodes.push({
      id: conv.id,
      loc: conv.loc,
      label: labelOf(conv),
      kind: 'conversation',
      parentId: null,
      position: savedPosition(convData) ?? { x: conversationX, y: conversationY },
      width,
      height,
      isSetup: convData.isSetup === true,
      isFallback: convData.isFallback === true,
      startOrder: startOrderByLoc.get(conv.loc) ?? null,
      startTotal: startOrderByLoc.has(conv.loc) ? ordinary.length : null,
      goalCount: goals.length,
      stageIndex: null,
      extractionFields: [],
      promptRef: null,
    });
    canvasNodes.push(...stageNodes);
    conversationY += height + ROW_GAP;
  }

  // Implicit sequence edges between consecutive stages of a conversation.
  const canvasEdges: ConversationCanvasEdge[] = [];
  for (const conv of conversations) {
    const stages = canvasNodes.filter((n) => n.parentId === conv.id);
    for (let i = 0; i < stages.length - 1; i++) {
      canvasEdges.push({
        id: `sequence:${stages[i].id}:${stages[i + 1].id}`,
        sourceId: stages[i].id,
        targetId: stages[i + 1].id,
        kind: 'sequence',
        label: '',
        timing: null,
        isDetour: false,
        position: null,
        conditionText: null,
      });
    }
  }

  // Real routing-rule edges between displayed nodes, annotated with their
  // evaluation rank: rules from one source are checked in priority order
  // (ties broken by name for a stable display).
  const nodeIds = new Set(canvasNodes.map((n) => n.id));
  const rules = edges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
  const bySource = new Map<string, ConversationGraphEdgeInput[]>();
  for (const e of rules) {
    const list = bySource.get(e.sourceId);
    if (list) list.push(e);
    else bySource.set(e.sourceId, [e]);
  }
  for (const [, sourceRules] of bySource) {
    const ranked = [...sourceRules].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''),
    );
    for (const e of sourceRules) {
      const data = dataOf(e);
      canvasEdges.push({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        kind: 'rule',
        label: e.name ?? '',
        timing: timingOf(data),
        isDetour: behaviorOf(data) === 'detour',
        position: ranked.length > 1 ? ranked.indexOf(e) + 1 : null,
        conditionText: conditionTextOf(e.condition ?? null),
      });
    }
  }

  return { nodes: canvasNodes, edges: canvasEdges };
}

/**
 * The edge side panel's payload for every rule edge, built from the same
 * inputs as the canvas — one lookup table the page derives once.
 */
export function buildConversationEdgeDetails(
  nodes: readonly ConversationGraphNodeInput[],
  edges: readonly ConversationGraphEdgeInput[],
): ConversationEdgeDetail[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byLoc = new Map(nodes.map((n) => [n.loc, n]));
  // A stage target reads "conversation / stage" so it is not mistaken for a
  // conversation of the same name (display only, K1).
  const targetLabelOf = (target: ConversationGraphNodeInput): string => {
    if (!isStageLoc(target.loc)) return labelOf(target);
    const parent = byLoc.get(segments(target.loc).slice(0, 2).join(':'));
    return parent ? `${labelOf(parent)} / ${labelOf(target)}` : labelOf(target);
  };
  return edges
    .filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .map((e) => {
      const data = dataOf(e);
      return {
        id: e.id,
        name: e.name,
        sourceId: e.sourceId,
        sourceLabel: labelOf(byId.get(e.sourceId)!),
        targetId: e.targetId,
        targetLabel: targetLabelOf(byId.get(e.targetId)!),
        targetUrn: byId.get(e.targetId)!.urn ?? null,
        priority: e.priority ?? null,
        condition: e.condition ?? null,
        timing: timingOf(data),
        behavior: behaviorOf(data),
        data,
      };
    });
}
