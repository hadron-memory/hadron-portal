import { describe, expect, it } from 'vitest';
import { describeWarning, normalizeWarnings, warningSearchText } from './warnings';

const urn = 'hrn:node:acme.com:tasks:review-author';
const base = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: null, taskState: null };
const sentence = (w: Parameters<typeof describeWarning>[0]) => { const d = describeWarning(w); return `${d.text} ${d.urn ?? ''}`; };

describe('#1764 TASK_LESS_VISIBLE copy', () => {
  it('OK + URN: names the role, the field in words and returns the URN exactly as given', () => {
    const d = describeWarning({ ...base, taskState: 'OK', taskUrn: urn });
    expect(d.text).toContain('review');
    expect(d.text).toContain('author task');
    expect(d.urn).toBe(urn);
    expect(d.text).not.toContain(urn);
  });
  it('names the validation task in words', () => {
    expect(describeWarning({ ...base, field: 'validationTask', taskState: 'OK' }).text).toContain('validation task');
  });
  it('OK without a URN: role and field, no task reference', () => {
    const d = describeWarning({ ...base, taskState: 'OK' });
    expect(d.urn).toBeNull();
    expect(d.text).toContain('review'); expect(d.text).toContain('author task');
  });
  it.each(['UNREADABLE', 'BROKEN'])('%s without a URN says the manager cannot read the task or the reference is broken', state => {
    const d = describeWarning({ ...base, taskState: state });
    expect(d.urn).toBeNull();
    expect(d.text).toMatch(/you can.t read/i);
    expect(d.text).toMatch(/reference is broken/i);
  });
  it.each(['UNREADABLE', 'BROKEN'])('%s never names a URN even if one arrives', state => {
    expect(describeWarning({ ...base, taskState: state, taskUrn: urn }).urn).toBeNull();
  });
  it('no state and no URN says the check could not be completed after the save', () => {
    const d = describeWarning(base);
    expect(d.urn).toBeNull();
    expect(d.text).toMatch(/could not be completed/i);
    expect(d.text).toMatch(/after (the|this) save|after saving/i);
    expect(d.text).not.toMatch(/no one|nobody|missing reader/i);
  });
  it('an unknown state is treated as an incomplete check and never names a URN', () => {
    const d = describeWarning({ ...base, taskState: 'SURPRISE', taskUrn: urn });
    expect(d.urn).toBeNull(); expect(d.text).toMatch(/could not be completed/i);
  });
  it('is advisory: says may not, never cannot, never the raw code', () => {
    for (const w of [{ ...base, taskState: 'OK', taskUrn: urn }, { ...base, taskState: 'OK' }, { ...base, taskState: 'UNREADABLE' }, base]) {
      const text = sentence(w);
      expect(text).not.toContain('TASK_LESS_VISIBLE');
      expect(text).not.toMatch(/cannot/i);
    }
    expect(describeWarning({ ...base, taskState: 'OK' }).text).toMatch(/may not/i);
  });
  it('a null field renders one generic line and never throws', () => {
    const d = describeWarning({ ...base, field: null, taskState: 'OK', taskUrn: urn });
    expect(d.urn).toBeNull();
    expect(d.text).toContain('review'); expect(d.text).not.toContain('TASK_LESS_VISIBLE');
  });
  it('an unknown field renders the generic line', () => {
    const d = describeWarning({ ...base, field: 'mysteryField', taskState: 'OK', taskUrn: urn });
    expect(d.urn).toBeNull(); expect(d.text).not.toContain('mysteryField');
  });
  it('an unrecognized code renders the generic line, never the code', () => {
    const d = describeWarning({ ...base, code: 'SOMETHING_NEW', taskState: 'OK', taskUrn: urn });
    expect(d.urn).toBeNull(); expect(d.text).not.toContain('SOMETHING_NEW');
    expect(d.text).toContain('review');
  });
  it('the generic line is the same for an unknown code and a null field', () => {
    expect(describeWarning({ ...base, code: 'X', field: null }).text).toBe(describeWarning({ ...base, field: null }).text);
  });
});

describe('#1764 warning normalization', () => {
  it('keeps well-formed rows and returns [] for anything that is not a list', () => {
    expect(normalizeWarnings(undefined)).toEqual([]);
    expect(normalizeWarnings(null)).toEqual([]);
    expect(normalizeWarnings('x')).toEqual([]);
    expect(normalizeWarnings([])).toEqual([]);
    expect(normalizeWarnings([{ ...base, taskState: 'OK', taskUrn: urn }])).toEqual([{ ...base, taskState: 'OK', taskUrn: urn }]);
  });
  it('fills missing optional fields with null (an older answer without them)', () => {
    expect(normalizeWarnings([{ code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask' }])).toEqual([base]);
  });
  it('a malformed entry becomes a generic row instead of throwing or vanishing', () => {
    const rows = normalizeWarnings([7, null, { code: 3 }, { code: 'TASK_LESS_VISIBLE', role: 'r', field: 5, taskUrn: 9, taskState: 9 }]);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(() => describeWarning(row)).not.toThrow();
    expect(rows[3]).toMatchObject({ role: 'r', field: null, taskUrn: null, taskState: null });
  });
  it('search text carries everything the row renders, including the URN', () => {
    const text = warningSearchText({ ...base, taskState: 'OK', taskUrn: urn });
    expect(text).toContain(urn); expect(text).toContain('author task'); expect(text).not.toContain('TASK_LESS_VISIBLE');
  });
});
