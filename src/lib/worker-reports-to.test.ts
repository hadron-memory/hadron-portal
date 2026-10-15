import { describe, expect, it } from 'vitest';
import { reportsToOf, reportsToSortKey, type ReportsToTarget } from './worker-reports-to';

const roster = new Map<string, ReportsToTarget>([
  ['w-ada', { id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null }],
  ['w-old', { id: 'w-old', name: 'Old', urn: 'hrn:worker:acme.com:team:old', retiredAt: '2026-09-01T00:00:00.000Z' }],
]);

describe('reportsToOf (portal#1067)', () => {
  it('none when unset or masked (null), or not selected (undefined)', () => {
    expect(reportsToOf({ reportsToWorkerId: null, reportsToRetired: false })).toEqual({ kind: 'none' });
    expect(reportsToOf({})).toEqual({ kind: 'none' });
    expect(reportsToOf(null)).toEqual({ kind: 'none' });
  });

  it('resolves the target from the nested Worker on the single-worker read', () => {
    expect(
      reportsToOf({
        reportsToWorkerId: 'w-ada',
        reportsToRetired: false,
        reportsTo: { id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null },
      }),
    ).toEqual({ kind: 'known', id: 'w-ada', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retired: false });
  });

  it('resolves the target from the roster when only the id was selected', () => {
    expect(reportsToOf({ reportsToWorkerId: 'w-ada', reportsToRetired: false }, roster)).toMatchObject({
      kind: 'known', id: 'w-ada', name: 'Ada', retired: false,
    });
  });

  it('flags a retired target from the server flag OR the target row', () => {
    expect(reportsToOf({ reportsToWorkerId: 'w-ada', reportsToRetired: true }, roster)).toMatchObject({ retired: true });
    expect(reportsToOf({ reportsToWorkerId: 'w-old', reportsToRetired: false }, roster)).toMatchObject({ retired: true });
  });

  it('an unresolvable target stays known but unnamed, never dropped', () => {
    expect(reportsToOf({ reportsToWorkerId: 'w-gone', reportsToRetired: false }, roster)).toEqual({
      kind: 'known', id: 'w-gone', name: null, urn: null, retired: false,
    });
  });
});

describe('reportsToSortKey', () => {
  it('is empty for none, so the unassigned sort to the top level', () => {
    expect(reportsToSortKey({ kind: 'none' })).toBe('');
    expect(reportsToSortKey(reportsToOf({ reportsToWorkerId: 'w-ada' }, roster))).toBe('Ada');
    expect(reportsToSortKey(reportsToOf({ reportsToWorkerId: 'w-gone' }, roster))).toBe('w-gone');
  });
});
