import { describe, it, expect } from 'vitest';
import { LocalStorageViewStore } from './localStorageViewStore';
import { ViewStorageError } from './viewStore';
import type { SavedView } from './savedView';

// Map-backed fake Storage so the localStorage store is testable without a DOM.
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

const view = (): SavedView => ({
  sorting: [],
  columnFilters: [],
  globalFilter: '',
  columnVisibility: {},
  columnOrder: [],
  pagination: { pageIndex: 0, pageSize: 25 },
});

const KEY = 'usage:sessions';

describe('LocalStorageViewStore', () => {
  it('creates, lists, and gets', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    const r = await s.create(KEY, 'My view', view());
    expect(r.id).toBeTruthy();
    expect(r.listKey).toBe(KEY);
    expect(await s.list(KEY)).toHaveLength(1);
    expect((await s.get(KEY, r.id))?.name).toBe('My view');
  });

  it('scopes views per list key', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    await s.create(KEY, 'A', view());
    expect(await s.list('usage:memory')).toHaveLength(0);
  });

  it('allows duplicate names (distinct ids)', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    const a = await s.create(KEY, 'Same', view());
    const b = await s.create(KEY, 'Same', view());
    expect(a.id).not.toBe(b.id);
    expect(await s.list(KEY)).toHaveLength(2);
  });

  it('trims, rejects empty, and caps name length at 100', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    await expect(s.create(KEY, '   ', view())).rejects.toBeInstanceOf(ViewStorageError);
    const r = await s.create(KEY, '  Trimmed  ', view());
    expect(r.name).toBe('Trimmed');
    const long = await s.create(KEY, 'x'.repeat(250), view());
    expect(long.name).toHaveLength(100);
  });

  it('updates name and view but not isDefault', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    const r = await s.create(KEY, 'A', view());
    const updated = await s.update(KEY, r.id, { name: 'B' });
    expect(updated.name).toBe('B');
    expect(updated.isDefault).toBe(false);
  });

  it('enforces a single default via setDefault', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    const a = await s.create(KEY, 'A', view());
    const b = await s.create(KEY, 'B', view());
    await s.setDefault(KEY, a.id);
    expect((await s.getDefault(KEY))?.id).toBe(a.id);
    await s.setDefault(KEY, b.id);
    const all = await s.list(KEY);
    expect(all.filter((r) => r.isDefault).map((r) => r.id)).toEqual([b.id]);
    await s.setDefault(KEY, null);
    expect(await s.getDefault(KEY)).toBeNull();
  });

  it('tracks the active id and clears it when the active view is removed', async () => {
    const s = new LocalStorageViewStore(fakeStorage());
    const a = await s.create(KEY, 'A', view());
    await s.setActiveId(KEY, a.id);
    expect(await s.getActiveId(KEY)).toBe(a.id);
    await s.remove(KEY, a.id);
    expect(await s.list(KEY)).toHaveLength(0);
    expect(await s.getActiveId(KEY)).toBeNull();
  });

  it('degrades gracefully when storage is unavailable', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const s = new LocalStorageViewStore(throwing);
    // reads never throw
    expect(await s.list(KEY)).toEqual([]);
    expect(await s.getActiveId(KEY)).toBeNull();
    // writes surface a typed error
    await expect(s.create(KEY, 'A', view())).rejects.toBeInstanceOf(ViewStorageError);
  });
});
