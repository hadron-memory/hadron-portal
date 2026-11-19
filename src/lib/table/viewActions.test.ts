import { describe, it, expect } from 'vitest';
import type { PortalTable } from '$lib/table/features';
import { LocalStorageViewStore } from './localStorageViewStore';
import { ViewStorageError, viewStorageErrorMessages } from './viewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve, duplicateView, migrateStoredView } from './viewActions';

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

// Minimal table stub recording applied setters; the backing state object is
// mutable so we can simulate the user changing the live arrangement. v9 reads
// whole state through `table.store.get()` (v8's `table.getState()`).
function tableStub() {
  const state = {
    sorting: [],
    columnFilters: [],
    globalFilter: '',
    columnVisibility: {},
    columnOrder: [] as string[],
    columnSizing: {},
    pagination: { pageIndex: 0, pageSize: 25 },
  };
  const calls: string[] = [];
  const push = (n: string) => () => void calls.push(n);
  return {
    __state: state,
    calls,
    store: { get: () => state },
    // The list's current columns, in definition order (portal#2253 item 4:
    // the migration reads the default order to place columns a saved view
    // predates).
    getAllLeafColumns: () => [{ id: 'colA' }, { id: 'colB' }, { id: 'colC' }],
    setSorting: push('setSorting'),
    setColumnFilters: push('setColumnFilters'),
    setGlobalFilter: push('setGlobalFilter'),
    setColumnVisibility: push('setColumnVisibility'),
    // Records the order it was given so the quota-pin below can assert what the
    // table actually received, not just that the setter ran.
    setColumnOrder: (order: string[]) => { calls.push('setColumnOrder'); state.columnOrder = order; },
    setColumnSizing: push('setColumnSizing'),
    setPagination: push('setPagination'),
    reset: push('reset'),
    // v9 constrains TData to RowData (Record<string, any> | any[]), so the stub
    // can no longer be typed as PortalTable<unknown>.
  } as unknown as PortalTable<Record<string, unknown>> & {
    __state: typeof state;
    calls: string[];
  };
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

describe('portal#2253 item 4 — applying a stored view that predates a column', () => {
  it('applyAndActivate migrates the stored order and persists the merge', async () => {
    const s = store();
    const t = tableStub();
    // A view saved when the list had only colA and colC, dragged around.
    const stale = await s.create(KEY, 'Old', {
      sorting: [], columnFilters: [], globalFilter: '', columnVisibility: {},
      columnOrder: ['colC', 'colA'], columnSizing: {},
      pagination: { pageIndex: 0, pageSize: 25 },
    });
    await applyAndActivate(s, t, KEY, stale);
    const activated = await s.get(KEY, stale.id);
    // colB (added later, default position between colA and colC) merges in
    // after colA — its closest surviving default predecessor — and the merge
    // is persisted, not just applied.
    expect(activated?.view.columnOrder).toEqual(['colC', 'colA', 'colB']);
  });

  it('an up-to-date stored view applies with no rewrite', async () => {
    const s = store();
    const t = tableStub();
    const fresh = await s.create(KEY, 'Fresh', {
      sorting: [], columnFilters: [], globalFilter: '', columnVisibility: {},
      columnOrder: ['colA', 'colB', 'colC'], columnSizing: {},
      pagination: { pageIndex: 0, pageSize: 25 },
    });
    await applyAndActivate(s, t, KEY, fresh);
    expect(await s.get(KEY, fresh.id)).toMatchObject({ updatedAt: fresh.updatedAt });
  });
});

describe('portal#2253 item 4 — the merge survives a failing persist', () => {
  /** A store whose update() always throws, reading and writing the same
   * backing storage as `s` for everything else — the quota-exceeded world. */
  const updateThrowing = (err: Error, s: LocalStorageViewStore): LocalStorageViewStore =>
    Object.assign(Object.create(Object.getPrototypeOf(s)), s, {
      update: async () => { throw err; },
    });

  const staleRecord = (s: LocalStorageViewStore) => s.create(KEY, 'Old', {
    sorting: [], columnFilters: [], globalFilter: '', columnVisibility: {},
    columnOrder: ['colC', 'colA'], columnSizing: {},
    pagination: { pageIndex: 0, pageSize: 25 },
  });

  it('returns the merged record in memory when the store throws ViewStorageError, and leaves storage for the next mount to retry', async () => {
    const s = store();
    const t = tableStub();
    const stale = await staleRecord(s);
    const failing = updateThrowing(new ViewStorageError(viewStorageErrorMessages.unavailable), s);
    const merged = await migrateStoredView(failing, t, KEY, stale);
    expect(merged.view.columnOrder).toEqual(['colC', 'colA', 'colB']);
    // The stored record keeps its pre-merge order: nothing was written.
    expect((await s.get(KEY, stale.id))?.view.columnOrder).toEqual(['colC', 'colA']);
  });

  it('re-throws anything that is not a ViewStorageError', async () => {
    const s = store();
    const t = tableStub();
    const stale = await staleRecord(s);
    const failing = updateThrowing(new Error('a real bug'), s);
    await expect(migrateStoredView(failing, t, KEY, stale)).rejects.toThrow('a real bug');
  });

  it('applyAndActivate still applies the merged order when the persist fails', async () => {
    const s = store();
    const t = tableStub();
    const stale = await staleRecord(s);
    const failing = updateThrowing(new ViewStorageError(viewStorageErrorMessages.unavailable), s);
    await expect(applyAndActivate(failing, t, KEY, stale)).resolves.toBeUndefined();
    expect(t.__state.columnOrder).toEqual(['colC', 'colA', 'colB']);
  });
});
