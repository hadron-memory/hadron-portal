/**
 * portal#1462 — the receipt's cadence copy is bounded to what the result
 * proves (Xavier's gate delta 2). The result carries the EFFECTIVE cadence and
 * not the template's declared one, so the client can never know a floor raised
 * anything: equal to the App's floor earns the floor label, nothing earns
 * "raised".
 */
import { describe, expect, it } from 'vitest';
import { applyResultFor, floorLabel } from './apply';

describe('floorLabel', () => {
  it('effective above the floor: no label', () => {
    expect(floorLabel(600, 300)).toBeNull();
  });
  it('effective equal to the floor: "the App’s floor", and never "raised"', () => {
    const label = floorLabel(300, 300);
    expect(label).toBe('the App’s floor');
    expect(label).not.toMatch(/rais/i);
  });
  it('an unreadable floor: no label (never inferred)', () => {
    expect(floorLabel(300, null)).toBeNull();
  });
  it('effective below the floor (a stale read): no label', () => {
    expect(floorLabel(60, 300)).toBeNull();
  });
});

describe('applyResultFor', () => {
  const r = { key: 'w-A', ok: true as const, created: [], alreadyPresent: [] };
  it('is the result only for the worker it was written for', () => {
    expect(applyResultFor(r, 'w-A')).toBe(r);
    expect(applyResultFor(r, 'w-B')).toBeNull();
    expect(applyResultFor(undefined, 'w-A')).toBeNull();
  });
});
