import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from './serializer.js';
import type { UiCondition } from './types.js';

function roundTrip(ui: UiCondition) {
  const json = serialize(ui);
  const back = deserialize(json);
  expect(back.ok, `deserialize failed: ${back.ok ? '' : back.reason}`).toBe(true);
  if (back.ok) return back.ui;
  throw new Error('unreachable');
}

describe('serializer / serialize', () => {
  it('serializes null to null (always fires)', () => {
    expect(serialize(null)).toBeNull();
  });

  it('emits a single child without the group wrapper', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        { kind: 'clause', field: 'memory.business_type', operator: 'missing' },
      ],
    };
    expect(serialize(ui)).toEqual({ missing: ['memory.business_type'] });
  });

  it('wraps multi-clause groups with the combinator', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        { kind: 'clause', field: 'memory.business_type', operator: 'missing' },
        {
          kind: 'clause',
          field: 'chat.message_count',
          operator: '>',
          value: { kind: 'literal', literal: '20' },
        },
      ],
    };
    expect(serialize(ui)).toEqual({
      and: [
        { missing: ['memory.business_type'] },
        { '>': [{ var: 'chat.message_count' }, 20] },
      ],
    });
  });

  it('parses literals into the right primitive shapes', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        { kind: 'clause', field: 'memory.flag', operator: '==', value: { kind: 'literal', literal: 'true' } },
        { kind: 'clause', field: 'memory.count', operator: '<', value: { kind: 'literal', literal: '3.5' } },
        { kind: 'clause', field: 'memory.label', operator: '==', value: { kind: 'literal', literal: 'tech' } },
        { kind: 'clause', field: 'memory.x', operator: '==', value: { kind: 'literal', literal: 'null' } },
      ],
    };
    expect(serialize(ui)).toEqual({
      and: [
        { '==': [{ var: 'memory.flag' }, true] },
        { '<': [{ var: 'memory.count' }, 3.5] },
        { '==': [{ var: 'memory.label' }, 'tech'] },
        { '==': [{ var: 'memory.x' }, null] },
      ],
    });
  });

  it('serializes variable-typed RHS to {var: path}', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'clause',
          field: 'message.data.confidence',
          operator: '<',
          value: { kind: 'variable', path: 'agent.config.confidence_threshold' },
        },
      ],
    };
    expect(serialize(ui)).toEqual({
      '<': [{ var: 'message.data.confidence' }, { var: 'agent.config.confidence_threshold' }],
    });
  });

  it('serializes `in` with comma-separated literals', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'clause',
          field: 'memory.industry',
          operator: 'in',
          value: { kind: 'literal', literal: 'tech, healthcare, retail' },
        },
      ],
    };
    expect(serialize(ui)).toEqual({
      in: [{ var: 'memory.industry' }, ['tech', 'healthcare', 'retail']],
    });
  });

  it('handles nested groups', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'or',
      children: [
        {
          kind: 'clause',
          field: 'memory.revenue_status',
          operator: '==',
          value: { kind: 'literal', literal: 'struggling' },
        },
        {
          kind: 'clause',
          field: 'memory.runway_months',
          operator: '<',
          value: { kind: 'literal', literal: '3' },
        },
      ],
    };
    expect(serialize(ui)).toEqual({
      or: [
        { '==': [{ var: 'memory.revenue_status' }, 'struggling'] },
        { '<': [{ var: 'memory.runway_months' }, 3] },
      ],
    });
  });
});

describe('serializer / deserialize', () => {
  it('returns null UI for null JSON', () => {
    const r = deserialize(null);
    expect(r).toEqual({ ok: true, ui: null });
  });

  it('round-trips Juno fixture #1', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        { kind: 'clause', field: 'memory.business_type', operator: 'missing' },
        { kind: 'clause', field: 'memory.team_size', operator: 'missing' },
      ],
    };
    expect(roundTrip(ui)).toEqual(ui);
  });

  it('round-trips fixture #4 (memory + chat mix)', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'clause',
          field: 'chat.message_count',
          operator: '>',
          value: { kind: 'literal', literal: '20' },
        },
        { kind: 'clause', field: 'memory.business_type', operator: 'missing' },
      ],
    };
    expect(roundTrip(ui)).toEqual(ui);
  });

  it('round-trips fixture #2 (or-group)', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'or',
      children: [
        {
          kind: 'clause',
          field: 'memory.revenue_status',
          operator: '==',
          value: { kind: 'literal', literal: 'struggling' },
        },
        {
          kind: 'clause',
          field: 'memory.runway_months',
          operator: '<',
          value: { kind: 'literal', literal: '3' },
        },
      ],
    };
    expect(roundTrip(ui)).toEqual(ui);
  });

  it('round-trips fixture #3 (in-list)', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'clause',
          field: 'memory.industry',
          operator: 'in',
          value: { kind: 'literal', literal: 'tech, healthcare, retail' },
        },
      ],
    };
    expect(roundTrip(ui)).toEqual(ui);
  });

  it('round-trips fixture #9 (variable RHS)', () => {
    const ui: UiCondition = {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'clause',
          field: 'message.data.confidence',
          operator: '<',
          value: { kind: 'variable', path: 'agent.config.confidence_threshold' },
        },
      ],
    };
    expect(roundTrip(ui)).toEqual(ui);
  });

  it('rejects unsupported operators (arithmetic) with a clear reason', () => {
    const json = {
      '<': [
        { var: 'memory.cumulative.protein' },
        { '*': [{ var: 'memory.targets.protein' }, 0.8] },
      ],
    };
    const r = deserialize(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toMatch(/unsupported|raw json/);
  });

  it('rejects custom operators not in the UI subset', () => {
    const r = deserialize({ cat: ['a', 'b'] });
    expect(r.ok).toBe(false);
  });

  it('promotes a top-level clause to a single-child group on load', () => {
    const r = deserialize({ missing: ['memory.x'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ui).toEqual({
        kind: 'group',
        combinator: 'and',
        children: [{ kind: 'clause', field: 'memory.x', operator: 'missing' }],
      });
    }
  });
});
