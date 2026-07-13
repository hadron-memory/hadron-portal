/**
 * Shared edge-editing logic for the two surfaces that edit an edge — the
 * full editor page (edges/[edgeId]) and the flow-canvas side panel
 * (FlowEdgePanel, #510). Extracted per the #510 review: the two had
 * copied each other's seeding/preview/parsing blocks and started to
 * drift. Pure data → data (plus the t() string boundary), so both
 * components stay thin and the walker-parity logic is unit-testable.
 */

import { describeCondition } from '$lib/edge-conditions/describe';
import { deserialize, serialize } from '$lib/edge-conditions/serializer';
import type { UiCondition } from '$lib/edge-conditions/types';
import { t } from '$lib/i18n/t';
import {
  buildRoutingName,
  isRoutingName,
  nextFreeRoutingIndex,
  parseRoutingName,
  routingNameOf,
  routingOrder,
} from './routing';
import type { RoutingEdgeLike } from './routing';

// ── Condition seeding / preservation ────────────────────────────────────────

/**
 * Seed the ConditionBuilder from a stored JSONLogic condition.
 * deserialize() can fail for shapes the structured builder can't
 * represent; on failure the raw value is shown read-only and preserved
 * verbatim on save — letting the empty builder serialize over it would
 * silently clear the condition (#350 review).
 */
export function seedConditionState(condition: unknown): { ui: UiCondition; error: string | null } {
  const r = deserialize(condition);
  return r.ok ? { ui: r.ui, error: null } : { ui: null, error: r.reason };
}

/**
 * The hidden `condition` form field's value: preserve an unrepresentable
 * condition verbatim, otherwise serialize the builder (null = always
 * fires → CLEAR on save).
 */
export function conditionJsonFor(
  conditionError: string | null,
  storedCondition: unknown,
  ui: UiCondition,
): string {
  return conditionError ? JSON.stringify(storedCondition ?? null) : JSON.stringify(serialize(ui));
}

/** Plain-English summary of a sibling's stored JSONLogic condition. */
export function conditionSummary(cond: unknown): string {
  if (cond == null) return t('edge-editor.order.always', 'always fires');
  const r = deserialize(cond);
  if (!r.ok) return t('edge-editor.order.custom', 'custom condition');
  return describeCondition(r.ui) ?? t('edge-editor.order.always', 'always fires');
}

// ── Routing-mode seeding ────────────────────────────────────────────────────

/**
 * Seed routing mode from the loaded edge: whether it routes, and the
 * order/label its `next.<index>[.<label>]` name parses into.
 */
export function seedRoutingState(
  edge: { name: string | null; loc: string },
  sourceLoc: string,
): { routing: boolean; indexText: string; label: string } {
  const routingName = routingNameOf(edge, sourceLoc);
  const routing = isRoutingName(routingName);
  const parsed = routing ? parseRoutingName(routingName) : { index: null, label: null };
  return {
    routing,
    indexText: parsed.index !== null ? String(parsed.index) : '',
    label: parsed.label ?? '',
  };
}

/**
 * Order/label to apply when the user turns routing mode ON: adopt an
 * existing routing name's parts; default a blank order to the source's
 * next free index. Null = keep the current inputs.
 */
export function routingToggleSeed(
  name: string,
  currentIndexText: string,
  siblings: readonly RoutingEdgeLike[],
  sourceLoc: string,
): { indexText: string; label: string } | null {
  if (isRoutingName(name)) {
    const parsed = parseRoutingName(name);
    return {
      indexText: parsed.index !== null ? String(parsed.index) : '',
      label: parsed.label ?? '',
    };
  }
  if (currentIndexText === '') {
    return { indexText: String(nextFreeRoutingIndex(siblings, sourceLoc)), label: '' };
  }
  return null;
}

/**
 * Compose the routing name the form will submit from the order/label
 * inputs: `valid` is false for a non-integer order (blocks save), and
 * the name is built from the parsed index + slugified label.
 */
export function composeRoutingName(
  indexText: string,
  label: string,
): { valid: boolean; name: string } {
  const valid = indexText === '' || /^\d+$/.test(indexText);
  return {
    valid,
    name: buildRoutingName(valid && indexText !== '' ? Number(indexText) : null, label),
  };
}

// ── Firing-order preview ────────────────────────────────────────────────────

/**
 * Live firing order among the source node's edges — the walker's exact
 * ordering (priority asc → numeric index → loc) — with the edited edge's
 * unsaved name/priority/condition substituted so the UI previews what
 * saving would do. An unrepresentable condition stays as stored.
 */
export function previewFiringOrder<E extends RoutingEdgeLike & { id: string }>(
  siblings: readonly E[],
  sourceLoc: string,
  edited: {
    id: string;
    /** The name the form would submit (generated in routing mode, free-text otherwise). */
    name: string;
    /** The priority input's raw text; non-integer text falls back to the stored priority. */
    priorityText: string;
    condition: UiCondition;
    conditionError: string | null;
  },
) {
  const priorityNum = Number(edited.priorityText);
  const substituted = siblings.map((e) =>
    e.id === edited.id
      ? {
          ...e,
          name: edited.name || null,
          priority: Number.isInteger(priorityNum) ? priorityNum : (e.priority ?? 0),
          condition: edited.conditionError ? e.condition : serialize(edited.condition),
        }
      : e,
  );
  return routingOrder(substituted, sourceLoc);
}

// (The server-action form parsers live in ./edge-form — kept separate so
// actions don't import this module's UI-presentation/i18n dependencies.)
