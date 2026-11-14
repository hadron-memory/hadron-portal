import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper shared with the layout script
import { sameMembers, pointerVerdict } from './cell-harness-checks.mjs';

// portal#2129 row 4: a structural compare, not a JSON.stringify of two arrays.
describe('sameMembers', () => {
  it('matches equal and reordered sets', () => {
    expect(sameMembers(['markers', 'plain'], ['markers', 'plain'])).toBe(true);
    expect(sameMembers(['plain', 'markers'], ['markers', 'plain'])).toBe(true);
  });
  it('rejects missing, extra and duplicate members', () => {
    expect(sameMembers(['markers'], ['markers', 'plain'])).toBe(false);
    expect(sameMembers(['markers', 'plain', 'x'], ['markers', 'plain'])).toBe(false);
    expect(sameMembers(['markers', 'markers'], ['markers', 'plain'])).toBe(false);
  });
  it('does not reorder its inputs', () => {
    const a = ['plain', 'markers'];
    sameMembers(a, ['markers', 'plain']);
    expect(a).toEqual(['plain', 'markers']);
  });
});

// portal#2129 row 7: the baseline is checked first and independently of the injected expectation.
describe('pointerVerdict', () => {
  const injected = 'pointer mode does not match the emulated device (injected)';
  const regression = (w: number, want: string, got: string) => `pointer baseline regression: expected ${want} at ${w}, got ${got}`;
  it.each([[390, true], [1280, false]])('correct baseline at %i queues nothing when not injecting', (width, actualCoarse) => {
    expect(pointerVerdict({ width, actualCoarse, inject: false })).toEqual([]);
  });
  it.each([[390, true], [1280, false]])('correct baseline at %i queues exactly the injected line when injecting', (width, actualCoarse) => {
    expect(pointerVerdict({ width, actualCoarse, inject: true })).toEqual([injected]);
  });
  // A wrong baseline must fail as a regression and must never read as a successful injection.
  it.each([[390, false, 'coarse', 'fine'], [1280, true, 'fine', 'coarse']])('wrong baseline at %i is a regression, injected or not', (width, actualCoarse, want, got) => {
    expect(pointerVerdict({ width, actualCoarse, inject: false })).toEqual([regression(width, want, got)]);
    expect(pointerVerdict({ width, actualCoarse, inject: true })).toEqual([regression(width, want, got)]);
  });
});
