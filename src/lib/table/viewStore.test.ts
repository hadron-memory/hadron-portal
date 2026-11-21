import { describe, it, expect, vi } from 'vitest';
import { LocalStorageViewStore } from './localStorageViewStore';
import { ViewStorageError, viewStorageErrorMessages } from './viewStore';
import { savedViewsStrings } from '$lib/i18n/saved-views-strings';
import { viewStorageErrorText } from '$lib/test/viewStorageErrorText';
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
  columnSizing: {},
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

  it('normalizes legacy stored views missing newer slices (forward-compat)', async () => {
    const storage = fakeStorage();
    // A record saved before columnSizing existed (no columnSizing key).
    const legacy = [
      {
        id: 'legacy-1',
        listKey: KEY,
        name: 'Legacy',
        isDefault: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        view: {
          sorting: [],
          columnFilters: [],
          globalFilter: '',
          columnVisibility: {},
          columnOrder: [],
          pagination: { pageIndex: 0, pageSize: 20 },
        },
      },
    ];
    storage.setItem(`hadron:views:v1:${KEY}`, JSON.stringify(legacy));
    const s = new LocalStorageViewStore(storage);
    const got = await s.list(KEY);
    // missing slice is filled so it won't read as perpetually "modified"
    expect(got[0].view.columnSizing).toEqual({});
  });

  // The App-memories restore pin (AppMemories.client.test.ts) asserts "no
  // storage error surfaced" via the shared `viewStorageErrorText` regex.
  // This is the join between the two files, proven in both directions:
  // every message the store throws IS a member of the family the regex is
  // built from (the literals below are gone — the throw sites use the same
  // constants, so a reword cannot desync them), and the regex is not
  // vacuously broad. The client lane adds the render-path positive control.
  it('throws exactly the ViewStorageError message family the restore pin keys on', async () => {
    const base = fakeStorage();
    const failing = new LocalStorageViewStore({
      ...base,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage);
    await expect(failing.create(KEY, 'v', view())).rejects.toThrow(viewStorageErrorMessages.saveFailed);
    await expect(failing.setActiveId(KEY, 'v1')).rejects.toThrow(viewStorageErrorMessages.saveActiveFailed);
    // no injected storage and no DOM localStorage — stubbed explicitly so the
    // case cannot start silently passing (or failing) the day the node lane
    // grows a real localStorage global
    vi.stubGlobal('localStorage', undefined);
    try {
      await expect(new LocalStorageViewStore(undefined as never).create(KEY, 'v', view())).rejects.toThrow(
        viewStorageErrorMessages.unavailable,
      );
    } finally {
      vi.unstubAllGlobals();
    }
    const working = new LocalStorageViewStore(fakeStorage());
    await expect(working.update(KEY, 'missing', {})).rejects.toThrow(viewStorageErrorMessages.viewNotFound);
    await expect(working.create(KEY, '   ', view())).rejects.toThrow(viewStorageErrorMessages.emptyName);
    // every family member, plus ViewTabs.run's generic catch-all for any
    // non-ViewStorageError, is matched by the shared regex the client-lane
    // pins use — the join this test exists to hold together
    for (const msg of [...Object.values(viewStorageErrorMessages), savedViewsStrings.updateError()]) {
      expect(msg).toMatch(viewStorageErrorText);
    }
    // non-vacuous in the other direction: the regex is not so broad that any
    // red text would satisfy it
    expect('Could not load this App’s memories. Reload to try again.').not.toMatch(viewStorageErrorText);
  });
});
