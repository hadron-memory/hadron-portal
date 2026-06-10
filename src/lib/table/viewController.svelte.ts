// Runes controller binding a grid `table` + `listKey` + `ViewStore` (spec 020).
// Holds the reactive picker state and the actions; this is the testable logic
// (the ViewPicker component is a thin shell over it).
import type { Table, RowData } from '@tanstack/table-core';
import { extractView, applyView, serializeView } from './savedView';
import { type ViewStore, type SavedViewRecord, resolveInitialView } from './viewStore';
import { localStorageViewStore } from './localStorageViewStore';

export interface ViewController {
  readonly views: SavedViewRecord[];
  readonly activeId: string | null;
  readonly activeView: SavedViewRecord | null;
  readonly isModified: boolean;
  init(): Promise<void>;
  select(id: string): Promise<void>;
  saveAs(name: string): Promise<void>;
  save(): Promise<void>;
  reset(): void;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}

export function createViewController<T extends RowData>(args: {
  table: Table<T>;
  listKey: string;
  store?: ViewStore;
}): ViewController {
  const { table, listKey } = args;
  const store = args.store ?? localStorageViewStore;

  let views = $state<SavedViewRecord[]>([]);
  let activeId = $state<string | null>(null);

  const activeView = $derived(views.find((v) => v.id === activeId) ?? null);

  // Canonical-JSON compare of the live arrangement vs the active view. Guarded so
  // there is no `activeView.view` deref when nothing is active (spec FR-006).
  const isModified = $derived.by(() =>
    activeView ? serializeView(extractView(table.getState())) !== serializeView(activeView.view) : false,
  );

  async function refresh() {
    views = await store.list(listKey);
  }

  async function init() {
    await refresh();
    const target = resolveInitialView(views, await store.getActiveId(listKey));
    if (target) {
      applyView(table, target.view);
      activeId = target.id;
    }
  }

  async function select(id: string) {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    applyView(table, v.view); // discards any unsaved tweaks (FR-007)
    activeId = id;
    await store.setActiveId(listKey, id);
  }

  async function saveAs(name: string) {
    const isFirst = views.length === 0;
    const record = await store.create(listKey, name, extractView(table.getState()));
    if (isFirst) await store.setDefault(listKey, record.id); // first view → default
    await store.setActiveId(listKey, record.id);
    await refresh();
    activeId = record.id;
  }

  async function save() {
    if (!activeView) return;
    await store.update(listKey, activeView.id, { view: extractView(table.getState()) });
    await refresh();
  }

  function reset() {
    if (activeView) applyView(table, activeView.view);
  }

  async function rename(id: string, name: string) {
    await store.update(listKey, id, { name });
    await refresh();
  }

  async function remove(id: string) {
    const wasActive = activeId === id;
    await store.remove(listKey, id);
    await refresh();
    if (wasActive) {
      // Re-resolve: default → built-in (leave the table as-is if no default).
      const def = views.find((v) => v.isDefault) ?? null;
      if (def) {
        applyView(table, def.view);
        activeId = def.id;
        await store.setActiveId(listKey, def.id);
      } else {
        activeId = null;
        await store.setActiveId(listKey, null);
      }
    }
  }

  async function setDefault(id: string) {
    await store.setDefault(listKey, id);
    await refresh();
  }

  return {
    get views() {
      return views;
    },
    get activeId() {
      return activeId;
    },
    get activeView() {
      return activeView;
    },
    get isModified() {
      return isModified;
    },
    init,
    select,
    saveAs,
    save,
    reset,
    rename,
    remove,
    setDefault,
  };
}
