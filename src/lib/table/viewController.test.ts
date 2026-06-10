import { describe, it, expect } from 'vitest';
import { resolveInitialView, type SavedViewRecord } from './viewStore';
import type { SavedView } from './savedView';

// The reactive controller glue is verified manually (runes + DOM); its core
// resolution logic is pure and unit-tested here.

const view = (): SavedView => ({
  sorting: [],
  columnFilters: [],
  globalFilter: '',
  columnVisibility: {},
  columnOrder: [],
  columnSizing: {},
  pagination: { pageIndex: 0, pageSize: 25 },
});

const rec = (id: string, isDefault = false): SavedViewRecord => ({
  id,
  listKey: 'k',
  name: id,
  view: view(),
  isDefault,
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
});

describe('resolveInitialView (active → default → built-in)', () => {
  const views = [rec('a'), rec('b', true), rec('c')];

  it('prefers the remembered active view', () => {
    expect(resolveInitialView(views, 'c')?.id).toBe('c');
  });

  it('falls back to the default when there is no active id', () => {
    expect(resolveInitialView(views, null)?.id).toBe('b');
  });

  it('falls back to the default when the active id is stale', () => {
    expect(resolveInitialView(views, 'gone')?.id).toBe('b');
  });

  it('returns null (built-in) when there is no active and no default', () => {
    expect(resolveInitialView([rec('a'), rec('c')], null)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(resolveInitialView([], 'x')).toBeNull();
  });
});
