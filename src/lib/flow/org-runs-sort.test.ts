import { describe, expect, it } from 'vitest';
import { orgRunsSortSearch, parseOrgRunsSort } from './org-runs-sort';

describe('parseOrgRunsSort', () => {
  it('reads only sort=duration and defaults the direction to desc', () => {
    expect(parseOrgRunsSort(new URLSearchParams(''))).toEqual({ sort: null, dir: 'desc' });
    expect(parseOrgRunsSort(new URLSearchParams('sort=duration'))).toEqual({ sort: 'duration', dir: 'desc' });
    expect(parseOrgRunsSort(new URLSearchParams('sort=duration&dir=asc'))).toEqual({ sort: 'duration', dir: 'asc' });
    expect(parseOrgRunsSort(new URLSearchParams('sort=started&dir=asc'))).toEqual({ sort: null, dir: 'asc' });
  });
});

describe('orgRunsSortSearch', () => {
  it('sets the pair for Duration in either direction and keeps unrelated params', () => {
    expect(orgRunsSortSearch(new URLSearchParams('x=1'), [{ id: 'duration', desc: true }])).toBe('?x=1&sort=duration&dir=desc');
    expect(orgRunsSortSearch(new URLSearchParams(''), [{ id: 'duration', desc: false }])).toBe('?sort=duration&dir=asc');
  });
  it('clears the pair when another column, or nothing, is sorted', () => {
    expect(orgRunsSortSearch(new URLSearchParams('sort=duration&dir=asc'), [{ id: 'started', desc: true }])).toBe('');
    expect(orgRunsSortSearch(new URLSearchParams('sort=duration&dir=asc&x=1'), [])).toBe('?x=1');
  });
});
