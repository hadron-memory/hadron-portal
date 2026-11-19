import { describe, it, expect } from 'vitest';
import { makeHeadlessTable } from '$lib/table/headlessTable';
import type { PortalColumnDef, PortalTable } from '$lib/table/features';
import { extractView, applyView, serializeView, mergeMissingColumns } from './savedView';
import { resolveInitialView } from './viewStore';
import { LocalStorageViewStore } from './localStorageViewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve, migrateStoredView } from './viewActions';

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
const columns: PortalColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'nodeType', header: 'Type' },
  { accessorKey: 'description', header: 'Description' },
];

// A headless table. Under v8 this had to self-manage every slice — including
// globalFilter, which table-core had no default state updater for, so it needed
// its own onGlobalFilterChange. v9 owns all registered slices internally, so
// construction is just the options object.
function makeTable(): PortalTable<Row> {
  return makeHeadlessTable<Row>({
    data: DATA,
    columns,
    globalFilterFn: 'includesString',
  });
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
async function reload(storage: Storage): Promise<PortalTable<Row>> {
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
    expect(t2.atoms.sorting.get()).toEqual([{ id: 'name', desc: true }]);
    expect(t2.atoms.globalFilter.get()).toBe('bob');
    expect(t2.atoms.pagination.get().pageSize).toBe(10);
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
    expect((await reload(storage)).atoms.sorting.get()).toEqual([{ id: 'name', desc: false }]);

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
    const isModified = serializeView(extractView(t.store.get())) !== serializeView(active.view);
    expect(isModified).toBe(true);

    // save → persisted; reload restores the new arrangement
    await overwriteView(store, t, KEY, v.id);
    expect((await reload(storage)).atoms.sorting.get()).toEqual([{ id: 'nodeType', desc: true }]);

    // reset → reverts the live table to the (now-saved) active view
    t.setSorting([{ id: 'name', desc: false }]);
    applyView(t, (await store.get(KEY, v.id))!.view);
    expect(t.atoms.sorting.get()).toEqual([{ id: 'nodeType', desc: true }]);
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
    expect(t.atoms.sorting.get()).toEqual([]); // table.reset() restored built-in
  });
});

describe('portal#2253 item 4 — a saved arrangement predating a column', () => {
  const boardDefault = ['status', 'title', 'priority', 'startBy', 'finishBy', 'owner', 'assignee', 'subtasks', 'updated'];

  it('merges a missing column in right after its closest surviving predecessor', () => {
    // The board case: Finish by added after Start by; the saved (dragged) order
    // predates it. Bare table-core appends it behind Updated, past the fold.
    expect(mergeMissingColumns(boardDefault, ['status', 'title', 'priority', 'owner', 'assignee', 'subtasks', 'startBy', 'updated']))
      .toEqual(['status', 'title', 'priority', 'owner', 'assignee', 'subtasks', 'startBy', 'finishBy', 'updated']);
  });

  it('weaves SEVERAL missing columns in, in their default order', () => {
    // A saved order from before BOTH deadline columns existed.
    expect(mergeMissingColumns(boardDefault, ['status', 'title', 'priority', 'owner', 'assignee', 'subtasks', 'updated']))
      .toEqual(['status', 'title', 'priority', 'startBy', 'finishBy', 'owner', 'assignee', 'subtasks', 'updated']);
  });

  it('keeps an empty saved order empty (natural order self-migrates)', () => {
    expect(mergeMissingColumns(boardDefault, [])).toEqual([]);
  });

  it('returns the saved order untouched when nothing is missing (no rewrite)', () => {
    const saved = [...boardDefault].reverse(); // every id present, dragged around
    expect(mergeMissingColumns(boardDefault, saved)).toBe(saved);
  });

  it('preserves stale ids (columns since removed) in place', () => {
    // 'b' enters right after 'a' (its closest surviving predecessor); 'gone'
    // stays between 'a' and 'c', where the user had it.
    expect(mergeMissingColumns(['a', 'b', 'c'], ['a', 'gone', 'c'])).toEqual(['a', 'b', 'gone', 'c']);
  });

  it('enters at the front when no predecessor survives (a new first column)', () => {
    expect(mergeMissingColumns(['new', 'a', 'b'], ['a', 'b'])).toEqual(['new', 'a', 'b']);
  });

  it('migrateStoredView persists the merge once, applies it, and stays un-modified', async () => {
    const storage = fakeStorage();
    const store = new LocalStorageViewStore(storage);
    // v1 of a list: three columns; the user dragged Type ahead of Name and saved.
    const t1 = makeTable();
    t1.setColumnOrder(['nodeType', 'name', 'description']);
    await createViewFrom(store, t1, KEY, 'Old layout', true);

    // v2 ships a URN column at a default position after Type (and Name).
    type RowV2 = Row & { urn: string };
    const t2 = makeHeadlessTable<RowV2>({
      data: DATA.map((d) => ({ ...d, urn: 'u' })),
      columns: [
        { accessorKey: 'name', header: 'Name' },
        { accessorKey: 'nodeType', header: 'Type' },
        { accessorKey: 'urn', header: 'URN' },
        { accessorKey: 'description', header: 'Description' },
      ] as PortalColumnDef<RowV2>[],
      globalFilterFn: 'includesString',
    });

    // The mount-time read path: resolve, migrate, persist. URN's immediate
    // default predecessor is Type, so it enters right after the user's Type —
    // not appended behind Description.
    const stored = resolveInitialView(await store.list(KEY), null)!;
    const migrated = await migrateStoredView(store, t2, KEY, stored);
    expect(migrated.view.columnOrder).toEqual(['nodeType', 'urn', 'name', 'description']);
    // Persisted: a re-read sees the merged order, and migration is now identity.
    const reread = resolveInitialView(await store.list(KEY), null)!;
    expect(reread.view.columnOrder).toEqual(['nodeType', 'urn', 'name', 'description']);
    await expect(migrateStoredView(store, t2, KEY, reread)).resolves.toBe(reread);

    // Applying it lands URN at its default position, and the live state equals
    // the stored view — the isModified compare stays quiet after a migration.
    applyView(t2, migrated.view);
    expect(t2.getVisibleLeafColumns().map((c) => c.id)).toEqual(['nodeType', 'urn', 'name', 'description']);
    expect(serializeView(extractView(t2.store.get()))).toEqual(serializeView(migrated.view));
  });
});
