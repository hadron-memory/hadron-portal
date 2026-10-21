/** portal#1148: null is withheld, never an empty roster or a zero. */
import { describe, expect, it } from 'vitest';
import { countOf, rosterOf } from './withheld';

describe('rosterOf', () => {
  it('null is withheld, not []', () => {
    expect(rosterOf(null)).toEqual({ kind: 'withheld' });
  });
  it('[] is a known-empty ok roster', () => {
    expect(rosterOf([])).toEqual({ kind: 'ok', items: [] });
  });
  it('rows are ok', () => {
    expect(rosterOf([{ id: 'a' }])).toEqual({ kind: 'ok', items: [{ id: 'a' }] });
  });
  it('an unselected field (undefined) is not a withholding', () => {
    expect(rosterOf(undefined)).toEqual({ kind: 'ok', items: [] });
  });
});

describe('countOf', () => {
  it('null stays null, never 0', () => {
    expect(countOf(null)).toBeNull();
    expect(countOf(undefined)).toBeNull();
  });
  it('a real zero is 0', () => {
    expect(countOf(0)).toBe(0);
    expect(countOf(4)).toBe(4);
  });
});
