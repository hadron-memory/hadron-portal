/**
 * Shared edge-editing logic (#510 review): seeding, condition
 * preservation, firing-order preview, and form parsing used by BOTH the
 * edge editor page and the flow-canvas side panel. Behavior here is
 * what keeps the two surfaces from drifting.
 */
import { describe, expect, it } from 'vitest';
import {
  composeRoutingName,
  conditionJsonFor,
  conditionSummary,
  previewFiringOrder,
  routingToggleSeed,
  seedConditionState,
  seedRoutingState,
} from './edge-editing';

const gt08 = { '>': [{ var: 'message.data.confidence' }, 0.8] };

describe('seedConditionState', () => {
  it('deserializes a representable condition into the builder tree', () => {
    const seeded = seedConditionState(gt08);
    expect(seeded.error).toBeNull();
    expect(seeded.ui).not.toBeNull();
  });

  it('keeps an unrepresentable condition out of the builder, with a reason', () => {
    const seeded = seedConditionState({ '+': [1, 2] });
    expect(seeded.ui).toBeNull();
    expect(seeded.error).toBeTruthy();
  });
});

describe('conditionJsonFor', () => {
  it('preserves the stored condition verbatim when the builder cannot represent it', () => {
    expect(conditionJsonFor('unsupported', { '+': [1, 2] }, null)).toBe('{"+":[1,2]}');
  });

  it('serializes the builder tree otherwise (null = always fires)', () => {
    expect(conditionJsonFor(null, gt08, null)).toBe('null');
    const seeded = seedConditionState(gt08);
    expect(JSON.parse(conditionJsonFor(null, gt08, seeded.ui))).toEqual(gt08);
  });
});

describe('conditionSummary', () => {
  it('describes stored, missing, and unrepresentable conditions', () => {
    expect(conditionSummary(null)).toBe('always fires');
    expect(conditionSummary({ '+': [1, 2] })).toBe('custom condition');
    expect(conditionSummary(gt08)).toContain('confidence');
  });
});

describe('seedRoutingState', () => {
  it('parses a routing name into order + label', () => {
    expect(seedRoutingState({ name: 'next.2.high', loc: 'classify:next-2-high:act' }, 'classify'))
      .toEqual({ routing: true, indexText: '2', label: 'high' });
  });

  it('derives the routing name from the loc for unnamed edges', () => {
    expect(seedRoutingState({ name: null, loc: 'classify:next:act' }, 'classify'))
      .toEqual({ routing: true, indexText: '', label: '' });
  });

  it('marks reference edges as non-routing', () => {
    expect(seedRoutingState({ name: 'documents', loc: 'classify:documents:spec' }, 'classify'))
      .toEqual({ routing: false, indexText: '', label: '' });
  });
});

describe('routingToggleSeed', () => {
  const siblings = [{ name: 'next.1', loc: 'classify:next-1:act' }];

  it('adopts an existing routing name’s parts', () => {
    expect(routingToggleSeed('next.3.high', '', siblings, 'classify'))
      .toEqual({ indexText: '3', label: 'high' });
  });

  it('defaults a blank order to the next free index', () => {
    expect(routingToggleSeed('cites', '', siblings, 'classify'))
      .toEqual({ indexText: '2', label: '' });
  });

  it('keeps the current inputs when an order is already set', () => {
    expect(routingToggleSeed('cites', '4', siblings, 'classify')).toBeNull();
  });
});

describe('previewFiringOrder', () => {
  const siblings = [
    { id: 'e1', name: 'next.1', loc: 'classify:next-1:act', priority: 0, condition: gt08 },
    { id: 'e2', name: 'next.2', loc: 'classify:next-2:defer', priority: 0, condition: null },
  ];
  const editedE1 = (overrides: Partial<Parameters<typeof previewFiringOrder>[2]>) =>
    previewFiringOrder(siblings, 'classify', {
      id: 'e1',
      name: 'next.1',
      priorityText: '0',
      condition: seedConditionState(gt08).ui,
      conditionError: null,
      ...overrides,
    });

  it('reproduces the stored order when nothing changed', () => {
    const order = editedE1({});
    expect(order.map((o) => o.edge.id)).toEqual(['e1', 'e2']);
    expect(order[1].isFallThrough).toBe(true);
  });

  it('substitutes the unsaved priority so the preview re-sorts', () => {
    const order = editedE1({ priorityText: '5' });
    expect(order.map((o) => o.edge.id)).toEqual(['e2', 'e1']);
    // e2 is condition-less: it becomes the fall-through and cuts e1 off.
    expect(order[0].isFallThrough).toBe(true);
    expect(order[1].isUnreachable).toBe(true);
  });

  it('keeps the stored condition when the builder cannot represent it', () => {
    const order = editedE1({ condition: null, conditionError: 'unsupported' });
    expect(order[0].edge.id).toBe('e1');
    expect(order[0].isFallThrough).toBe(false);
  });
});

describe('composeRoutingName', () => {
  it('builds next.<index>[.<label>] from the order/label inputs', () => {
    expect(composeRoutingName('2', 'High Confidence')).toEqual({
      valid: true,
      name: 'next.2.high-confidence',
    });
    expect(composeRoutingName('0', '')).toEqual({ valid: true, name: 'next.0' });
  });

  it('treats an empty order as index-less and a non-integer as invalid', () => {
    expect(composeRoutingName('', '')).toEqual({ valid: true, name: 'next' });
    expect(composeRoutingName('', 'high')).toEqual({ valid: true, name: 'next.high' });
    expect(composeRoutingName('1.5', 'high').valid).toBe(false);
  });
});
