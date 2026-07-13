/**
 * Edge-edit form-field parsing shared by the edge editor page and the
 * flow-canvas panel actions (#510 review).
 */
import { describe, expect, it } from 'vitest';
import { parseConditionField, parsePriorityField } from './edge-form';

const gt08 = { '>': [{ var: 'message.data.confidence' }, 0.8] };

describe('parsePriorityField', () => {
  it('defaults empty to 0 and trims', () => {
    expect(parsePriorityField('')).toEqual({ ok: true, value: 0 });
    expect(parsePriorityField(' 7 ')).toEqual({ ok: true, value: 7 });
    expect(parsePriorityField(null)).toEqual({ ok: true, value: 0 });
  });

  it('rejects non-integers via Number(), not parseInt()', () => {
    expect(parsePriorityField('1.5').ok).toBe(false);
    expect(parsePriorityField('abc').ok).toBe(false);
    // parseInt('1e2') would silently yield 1; Number() reads it as 100.
    expect(parsePriorityField('1e2')).toEqual({ ok: true, value: 100 });
  });
});

describe('parseConditionField', () => {
  it('parses JSONLogic and treats a missing field as null (CLEAR)', () => {
    expect(parseConditionField(JSON.stringify(gt08))).toEqual({ ok: true, value: gt08 });
    expect(parseConditionField(null)).toEqual({ ok: true, value: null });
  });

  it('rejects malformed JSON', () => {
    expect(parseConditionField('{nope').ok).toBe(false);
  });
});
