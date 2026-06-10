// localStorage implementation of ViewStore (spec 020, v1). Per-list namespaced
// keys; SSR/disabled-storage safe (reads degrade to empty, writes throw a typed
// error). Storage is injectable so the logic is unit-testable without a DOM.
import type { SavedView } from './savedView';
import {
  type ViewStore,
  type SavedViewRecord,
  ViewStorageError,
  normalizeViewName,
} from './viewStore';

const PREFIX = 'hadron:views:v1';
const recordsKey = (listKey: string) => `${PREFIX}:${listKey}`;
const activeKey = (listKey: string) => `${PREFIX}:active:${listKey}`;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

export class LocalStorageViewStore implements ViewStore {
  // Resolve lazily so importing this module under SSR never throws.
  constructor(private readonly injected?: Storage) {}

  private get storage(): Storage | null {
    if (this.injected) return this.injected;
    try {
      return typeof globalThis !== 'undefined' && globalThis.localStorage
        ? globalThis.localStorage
        : null;
    } catch {
      return null;
    }
  }

  private readRecords(listKey: string): SavedViewRecord[] {
    const s = this.storage;
    if (!s) return [];
    try {
      const raw = s.getItem(recordsKey(listKey));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedViewRecord[]) : [];
    } catch {
      return [];
    }
  }

  private writeRecords(listKey: string, records: SavedViewRecord[]): void {
    const s = this.storage;
    if (!s) throw new ViewStorageError('Storage is unavailable.');
    try {
      s.setItem(recordsKey(listKey), JSON.stringify(records));
    } catch {
      throw new ViewStorageError('Could not save views (storage full or disabled).');
    }
  }

  async list(listKey: string): Promise<SavedViewRecord[]> {
    return this.readRecords(listKey);
  }

  async get(listKey: string, id: string): Promise<SavedViewRecord | null> {
    return this.readRecords(listKey).find((r) => r.id === id) ?? null;
  }

  async create(listKey: string, name: string, view: SavedView): Promise<SavedViewRecord> {
    const records = this.readRecords(listKey);
    const ts = nowIso();
    const record: SavedViewRecord = {
      id: newId(),
      listKey,
      name: normalizeViewName(name),
      view,
      isDefault: false,
      createdAt: ts,
      updatedAt: ts,
    };
    records.push(record);
    this.writeRecords(listKey, records);
    return record;
  }

  async update(
    listKey: string,
    id: string,
    patch: Partial<Pick<SavedViewRecord, 'name' | 'view'>>,
  ): Promise<SavedViewRecord> {
    const records = this.readRecords(listKey);
    const idx = records.findIndex((r) => r.id === id);
    if (idx === -1) throw new ViewStorageError('View not found.');
    const next: SavedViewRecord = {
      ...records[idx],
      ...(patch.name !== undefined ? { name: normalizeViewName(patch.name) } : {}),
      ...(patch.view !== undefined ? { view: patch.view } : {}),
      updatedAt: nowIso(),
    };
    records[idx] = next;
    this.writeRecords(listKey, records);
    return next;
  }

  async remove(listKey: string, id: string): Promise<void> {
    const records = this.readRecords(listKey).filter((r) => r.id !== id);
    this.writeRecords(listKey, records);
    if ((await this.getActiveId(listKey)) === id) await this.setActiveId(listKey, null);
  }

  async getDefault(listKey: string): Promise<SavedViewRecord | null> {
    return this.readRecords(listKey).find((r) => r.isDefault) ?? null;
  }

  async setDefault(listKey: string, id: string | null): Promise<void> {
    const ts = nowIso();
    const records = this.readRecords(listKey).map((r) => {
      const isDefault = id != null && r.id === id;
      // Bump updatedAt only for records whose default flag actually changed.
      return isDefault === r.isDefault ? r : { ...r, isDefault, updatedAt: ts };
    });
    this.writeRecords(listKey, records);
  }

  async getActiveId(listKey: string): Promise<string | null> {
    const s = this.storage;
    if (!s) return null;
    try {
      return s.getItem(activeKey(listKey));
    } catch {
      return null;
    }
  }

  async setActiveId(listKey: string, id: string | null): Promise<void> {
    const s = this.storage;
    if (!s) throw new ViewStorageError('Storage is unavailable.');
    try {
      if (id == null) s.removeItem(activeKey(listKey));
      else s.setItem(activeKey(listKey), id);
    } catch {
      throw new ViewStorageError('Could not save the active view.');
    }
  }
}

/** Default store used by the picker when none is injected. */
export const localStorageViewStore: ViewStore = new LocalStorageViewStore();
