/**
 * Plain-English rendering of a structured condition (UiCondition) for
 * the edge editor's preview line — "when confidence is greater than
 * 0.8". Works on the SAME UI tree the ConditionBuilder edits, so the
 * preview tracks unsaved edits live; conditions the builder can't
 * represent never reach this function (they fail deserialize() first).
 */

import { t } from '$lib/i18n/t';
import type { UiClause, UiCondition, UiGroup, UiValue } from './types.js';
import { labelFor } from './known-variables.js';
import { lookupOwn } from '$lib/lookup';

/**
 * Friendly display name for a variable path. Envelope fields
 * (`message.data.confidence`) read as their bare field name; curated
 * paths use their catalog label; anything else shows verbatim.
 */
export function describeField(path: string): string {
  const known = labelFor(path);
  if (known) return known;
  if (path.startsWith('message.data.')) return path.slice('message.data.'.length);
  return path;
}

function describeValue(value: UiValue | undefined, operator: string): string {
  if (!value) return '';
  if (value.kind === 'variable') return describeField(value.path);
  if (operator === 'in') {
    const items = value.literal
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    return items.join(t('edge-conditions.describe.list-or', ' or '));
  }
  return value.literal === '' ? t('edge-conditions.describe.empty-value', '(empty)') : value.literal;
}

const OPERATOR_PHRASES: Record<string, string> = {
  '==': 'is',
  '!=': 'is not',
  '<': 'is less than',
  '<=': 'is at most',
  '>': 'is greater than',
  '>=': 'is at least',
  in: 'is one of',
};

function describeClause(clause: UiClause): string {
  const field = describeField(clause.field);
  if (clause.operator === 'missing') {
    return `${field} ${t('edge-conditions.describe.missing', 'is not set')}`;
  }
  // #835 — `lookupOwn`. The real gate is upstream and it is a good one:
  // `deserialize()` refuses any operator outside `UI_OPERATORS`, which is
  // already a `Set` and therefore immune, so a prototype key cannot reach a
  // clause built the normal way. Guarded anyway because the `??` here is the
  // only thing standing between a hand-built tree and an inherited value being
  // interpolated into a user-facing sentence — and `??` does not fire on one,
  // since a function is not nullish.
  const phrase = lookupOwn(OPERATOR_PHRASES, clause.operator) ?? clause.operator;
  return `${field} ${phrase} ${describeValue(clause.value, clause.operator)}`.trimEnd();
}

function describeGroup(group: UiGroup, nested: boolean): string {
  const parts = group.children
    .map((c) => (c.kind === 'clause' ? describeClause(c) : describeGroup(c, true)))
    .filter((s) => s !== '');
  if (parts.length === 0) return '';
  const joiner = group.combinator === 'and'
    ? t('edge-conditions.describe.and', ' and ')
    : t('edge-conditions.describe.or', ' or ');
  const joined = parts.join(joiner);
  return nested && parts.length > 1 ? `(${joined})` : joined;
}

/**
 * One sentence for the whole condition: "when confidence is greater
 * than 0.8", or null for an empty/absent condition (the caller decides
 * how to phrase "always fires" — for routing edges that's the
 * fall-through message).
 */
export function describeCondition(ui: UiCondition): string | null {
  if (ui === null) return null;
  const body = describeGroup(ui, false);
  if (body === '') return null;
  return `${t('edge-conditions.describe.when', 'when')} ${body}`;
}
