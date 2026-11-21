import { describe, expect, it } from 'vitest';
import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
import { updatedFilterText } from './format';

const ISO = '2026-11-02T09:30:15Z';
describe('the Updated filter text is what the cell shows', () => {
  it('matches the cell rendering of the same instant, never a dash', () => {
    const ms = parseApiDate(ISO)!.getTime();
    expect(updatedFilterText(ms)).toBe(fmtRunTime(ISO));
    expect(updatedFilterText(ms)).not.toBe('—');
    // Not red on main: parseApiDate still tolerates digit strings (a pre-#834 server tolerance), so
    // fmtRunTime(String(ms)) rendered the same. This pins the ISO path so the filter keeps matching
    // the cell once that tolerance is removed.
  });
  it('is empty for a missing or non-numeric value', () => {
    expect([updatedFilterText(0), updatedFilterText(undefined), updatedFilterText('x')]).toEqual(['', '', '']);
  });
});
