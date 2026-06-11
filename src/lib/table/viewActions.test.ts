import { describe, it, expect } from 'vitest';
import type { Table } from '@tanstack/table-core';
import { LocalStorageViewStore } from './localStorageViewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve, duplicateView } from './viewActions';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

// Minimal table stub recording applied setters; getState() is mutable so we can
// simulate the user changing the live arrangement.
function tableStub() {
  const state = {
    sorting: [],
    columnFilters: [],
    globalFilter: '',
    columnVisibility: {},
    columnOrder: [],
    columnSizing: {},
    pagination: { pageIndex: 0, pageSize: 25 },
  };
  const calls: string[] = [];
  const push = (n: string) => () => void calls.push(n);
  return {
    __state: state,
    calls,
    getState: () => state,
    setSorting: push('setSorting'),
    setColumnFilters: push('setColumnFilters'),
    setGlobalFilter: push('setGlobalFilter'),
    setColumnVisibility: push('setColumnVisibility'),
    setColumnOrder: push('setColumnOrder'),
    setColumnSizing: push('setColumnSizing'),
    setPagination: push('setPagination'),
    reset: push('reset'),
  } as unknown as Table<unknown> & { __state: typeof state; calls: string[] };
}

const KEY = 'usage:sessions';
const store = () => new LocalStorageViewStore(fakeStorage());

describe('createViewFrom', () => {
  it('marks the first view default and makes it active', async () => {
    const s = store();
    const t = tableStub();
    const r = await createViewFrom(s, t, KEY, 'First', true);
    expect((await s.getDefault(KEY))?.id).toBe(r.id);
    expect(await s.getActiveId(KEY)).toBe(r.id);
  });

  it('does not default a subsequent view but does make it active', async () => {
    const s = store();
    const t = tableStub();
    const first = await createViewFrom(s, t, KEY, 'First', true);
    const second = await createViewFrom(s, t, KEY, 'Second', false);
    expect((await s.getDefault(KEY))?.id).toBe(first.id); // default unchanged
    expect(await s.getActiveId(KEY)).toBe(second.id); // active follows latest
  });
});

describe('overwriteView', () => {
  it('overwrites the stored view with the current arrangement', async () => {
    const s = store();
    const t = tableStub();
    const r = await createViewFrom(s, t, KEY, 'A', true);
    (t as any).__state.globalFilter = 'changed';
    await overwriteView(s, t, KEY, r.id);
    expect((await s.get(KEY, r.id))?.view.globalFilter).toBe('changed');
  });
});

describe('applyAndActivate', () => {
  it('applies the view to the table and records it active', async () => {
    const s = store();
    const t = tableStub();
    const r = await createViewFrom(s, t, KEY, 'A', true);
    await applyAndActivate(s, t, KEY, r);
    expect(t.calls).toContain('setSorting');
    expect(t.calls).toContain('setPagination');
    expect(await s.getActiveId(KEY)).toBe(r.id);
  });
});

describe('removeAndResolve', () => {
  it('keeps the active id when a non-active view is removed', async () => {
    const s = store();
    const t = tableStub();
    const a = await createViewFrom(s, t, KEY, 'A', true);
    const b = await createViewFrom(s, t, KEY, 'B', false);
    const res = await removeAndResolve(s, t, KEY, b.id, false, a.id);
    expect(res.activeId).toBe(a.id);
    expect(res.views.map((v) => v.id)).toEqual([a.id]);
  });

  it('falls back to the default when the active view is removed', async () => {
    const s = store();
    const t = tableStub();
    const def = await createViewFrom(s, t, KEY, 'Default', true); // first → default
    const other = await createViewFrom(s, t, KEY, 'Other', false);
    await s.setActiveId(KEY, other.id);
    const res = await removeAndResolve(s, t, KEY, other.id, true, other.id);
    expect(res.activeId).toBe(def.id);
    expect(await s.getActiveId(KEY)).toBe(def.id);
  });

  it('resets to the built-in arrangement when the active view is removed and no default remains', async () => {
    const s = store();
    const t = tableStub();
    const only = await createViewFrom(s, t, KEY, 'Only', true);
    await s.setDefault(KEY, null); // no default
    const res = await removeAndResolve(s, t, KEY, only.id, true, only.id);
    expect(res.activeId).toBeNull();
    expect(t.calls).toContain('reset');
    expect(await s.getActiveId(KEY)).toBeNull();
  });
});

describe('duplicateView', () => {
  it('creates a copy of the source view, applies it, and makes it active', async () => {
    const s = store();
    const t = tableStub();
    const src = await createViewFrom(s, t, KEY, 'Original', true);
    const copy = await duplicateView(s, t, KEY, src, 'Original (copy)');
    expect(copy.id).not.toBe(src.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.isDefault).toBe(false);
    expect(copy.view).toEqual(src.view);
    expect(t.calls).toContain('setSorting'); // applied to the table
    expect(await s.getActiveId(KEY)).toBe(copy.id);
    expect(await s.list(KEY)).toHaveLength(2);
  });
});
