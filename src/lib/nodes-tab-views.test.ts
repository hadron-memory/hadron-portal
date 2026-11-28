import { describe, expect, it } from 'vitest';
import { NO_CRITERIA, type TableCriteria } from '$lib/nodes-tab-client';
import { criteriaToServerView, nodesListKey, viewToCriteria } from './nodes-tab-views';
import type { SavedView } from '$lib/table/savedView';

const TYPES = ['info', 'reference', 'prompt'];
const full: TableCriteria = { q: 'auth', types: ['info'], tags: ['a', 'b'], changed: '7d', mine: true, sort: 'relevance' };
const asView = (c: TableCriteria): SavedView => ({
  ...criteriaToServerView(c), globalFilter: '', columnVisibility: {}, columnOrder: [], columnSizing: {}, pagination: { pageIndex: 0, pageSize: 25 },
});

describe('nodes-tab saved views (#2705)', () => {
  it('round-trips every allow-listed parameter', () => {
    expect(viewToCriteria(asView(full), TYPES)).toEqual(full);
    expect(viewToCriteria(asView(NO_CRITERIA), TYPES)).toEqual(NO_CRITERIA);
  });

  it('the list key carries the viewer and the memory: two viewers never share one', () => {
    expect(nodesListKey('u1', 'm1')).not.toBe(nodesListKey('u2', 'm1'));
    expect(nodesListKey('u1', 'm1')).not.toBe(nodesListKey('u1', 'm2'));
    expect(nodesListKey('a:b', 'c')).not.toBe(nodesListKey('a', 'b:c'));
  });

  it('a hand-edited record cannot widen the read: unknown ids, types, sorts and control-char tags are dropped', () => {
    const evil = {
      ...asView(NO_CRITERIA),
      sorting: [{ id: 'memoryId', desc: false }],
      columnFilters: [
        { id: 'types', value: ['info', 'system', 'x'.repeat(50)] },
        { id: 'tags', value: ['ok', 'bad\u0007', 7, ''] },
        { id: 'changed', value: '1y' },
        { id: 'mine', value: 'yes' },
        { id: 'memoryIds', value: ['other'] },
        { id: 'q', value: 'x'.repeat(500) },
      ],
    } as SavedView;
    const c = viewToCriteria(evil, TYPES);
    expect(c.types).toEqual(['info']);
    expect(c.tags).toEqual(['ok']);
    expect(c.changed).toBe('');
    expect(c.mine).toBe(false);
    expect(c.sort).toBe('');
    expect(c.q).toHaveLength(200);
    expect(Object.keys(c).sort()).toEqual(Object.keys(NO_CRITERIA).sort());
  });

  it('malformed stored records are absent values, not a throw', () => {
    const odd = { ...asView(NO_CRITERIA), columnFilters: [null, 3, { id: 'q', value: 'k' }], sorting: [null] } as unknown as SavedView;
    expect(viewToCriteria(odd, TYPES).q).toBe('k');
    expect(viewToCriteria({ columnFilters: 'x', sorting: 'y' } as unknown as SavedView, TYPES)).toEqual(NO_CRITERIA);
    expect(viewToCriteria(null as unknown as SavedView, TYPES)).toEqual(NO_CRITERIA);
  });

  it('Best match without a text search is dropped, as the box itself does', () => {
    expect(viewToCriteria({ ...asView(NO_CRITERIA), sorting: [{ id: 'relevance', desc: false }] }, TYPES).sort).toBe('');
  });
});
