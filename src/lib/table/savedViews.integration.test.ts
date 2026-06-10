import { describe, it, expect } from 'vitest';
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type Table,
  type TableState,
  type TableOptionsResolved,
  type ColumnDef,
} from '@tanstack/table-core';
import { extractView, applyView, serializeView } from './savedView';
import { resolveInitialView } from './viewStore';
import { LocalStorageViewStore } from './localStorageViewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve } from './viewActions';

// End-to-end at the data layer: drives the REAL LocalStorageViewStore + REAL
// table-core instance + applyView through the user flows, with "reload"
// simulated by building a fresh table and re-resolving from persisted storage.
// (No browser-automation tooling is available; this covers the riskiest paths —
// sticky restore and delete-fallback — deterministically and as a regression guard.)

interface Row {
  name: string;
  nodeType: string;
  description: string;
}
const DATA: Row[] = [
  { name: 'Charlie', nodeType: 'task', description: 'c' },
  { name: 'Alice', nodeType: 'info', description: 'a' },
  { name: 'Bob', nodeType: 'info', description: 'b' },
];
const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'nodeType', header: 'Type' },
  { accessorKey: 'description', header: 'Description' },
];

// A headless table that fully self-manages state, including globalFilter (which
// table-core only updates via onGlobalFilterChange — no default state updater).
function makeTable(): Table<Row> {
  let state = {} as TableState;
  const table = createTable<Row>({
    data: DATA,
    columns,
    state,
    onStateChange: (u) => {
      state = u instanceof Function ? u(state) : u;
      table.setOptions((p) => ({ ...p, state }));
    },
    onGlobalFilterChange: (u) => {
      const next = u instanceof Function ? (u as (o: unknown) => unknown)(state.globalFilter) : u;
      state = { ...state, globalFilter: next } as TableState;
      table.setOptions((p) => ({ ...p, state }));
    },
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    renderFallbackValue: null,
  } as TableOptionsResolved<Row>);
  state = table.initialState;
  table.setOptions((p) => ({ ...p, state }));
  return table;
}

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

const KEY = 'memory:m1:nodes';

/** Simulate a page reload: a fresh table + re-resolve the view from storage. */
async function reload(storage: Storage): Promise<Table<Row>> {
  const store = new LocalStorageViewStore(storage);
  const table = makeTable();
  const target = resolveInitialView(await store.list(KEY), await store.getActiveId(KEY));
  if (target) applyView(table, target.view);
  return table;
}

describe('US1 — save an arrangement and have it come back', () => {
  it('restores sort + search + page size after a reload (sticky active view)', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    const t = makeTable();
    t.setSorting([{ id: 'name', desc: true }]);
    t.setGlobalFilter('bob');
    t.setPageSize(10);
    await createViewFrom(store, t, KEY, 'My view', true);

    const t2 = await reload(storage);
    expect(t2.getState().sorting).toEqual([{ id: 'name', desc: true }]);
    expect(t2.getState().globalFilter).toBe('bob');
    expect(t2.getState().pagination.pageSize).toBe(10);
  });
});

describe('US2 — multiple views: switch + default-on-fresh', () => {
  it('reapplies the last-selected view, and the default on a fresh open', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    const t = makeTable();

    t.setSorting([{ id: 'name', desc: false }]);
    const a = await createViewFrom(store, t, KEY, 'A', true); // first → default
    t.setSorting([{ id: 'nodeType', desc: true }]);
    const b = await createViewFrom(store, t, KEY, 'B', false);

    // switch back to A → reload reapplies A (sticky)
    await applyAndActivate(store, t, KEY, a);
    expect((await reload(storage)).getState().sorting).toEqual([{ id: 'name', desc: false }]);

    // clear the active pointer (first-ever-open) → default (A) applies, not B
    await store.setActiveId(KEY, null);
    const resolved = resolveInitialView(await store.list(KEY), null);
    expect(resolved?.id).toBe(a.id);

    // change the default to B → fresh open applies B
    await store.setDefault(KEY, b.id);
    expect(resolveInitialView(await store.list(KEY), null)?.id).toBe(b.id);
  });
});

describe('US3 — modified indicator + save/reset', () => {
  it('detects divergence, persists on save, reverts on reset', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    const t = makeTable();
    t.setSorting([{ id: 'name', desc: false }]);
    const v = await createViewFrom(store, t, KEY, 'V', true);

    // tweak → modified
    t.setSorting([{ id: 'nodeType', desc: true }]);
    const active = (await store.get(KEY, v.id))!;
    const isModified = serializeView(extractView(t.getState())) !== serializeView(active.view);
    expect(isModified).toBe(true);

    // save → persisted; reload restores the new arrangement
    await overwriteView(store, t, KEY, v.id);
    expect((await reload(storage)).getState().sorting).toEqual([{ id: 'nodeType', desc: true }]);

    // reset → reverts the live table to the (now-saved) active view
    t.setSorting([{ id: 'name', desc: false }]);
    applyView(t, (await store.get(KEY, v.id))!.view);
    expect(t.getState().sorting).toEqual([{ id: 'nodeType', desc: true }]);
  });
});

describe('US4 — delete with fallback', () => {
  it('falls back to the default when the active view is deleted', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    const t = makeTable();
    const def = await createViewFrom(store, t, KEY, 'Default', true);
    const other = await createViewFrom(store, t, KEY, 'Other', false);
    await store.setActiveId(KEY, other.id);

    const res = await removeAndResolve(store, t, KEY, other.id, true, other.id);
    expect(res.activeId).toBe(def.id);
    expect(await store.getActiveId(KEY)).toBe(def.id);
  });

  it('resets to the built-in arrangement when the deleted active view has no default fallback', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    const t = makeTable();
    const only = await createViewFrom(store, t, KEY, 'Only', true);
    await store.setDefault(KEY, null); // no default remains

    t.setSorting([{ id: 'name', desc: true }]); // a live arrangement to be reset
    const res = await removeAndResolve(store, t, KEY, only.id, true, only.id);
    expect(res.activeId).toBeNull();
    expect(await store.list(KEY)).toHaveLength(0);
    expect(t.getState().sorting).toEqual([]); // table.reset() restored built-in
  });
});
