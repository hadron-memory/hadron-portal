// Runes controller binding a grid `table` + `listKey` + `ViewStore` (spec 020).
// Holds the reactive picker state and the actions; this is the testable logic
// (the ViewTabs component is a thin shell over it).
import type { PortalTable } from '$lib/table/features';
import type { RowData } from '@tanstack/table-core';
import { extractView, extractTableView, applyView, serializeView } from './savedView';
import { type ViewStore, type SavedViewRecord, resolveInitialView } from './viewStore';
import { localStorageViewStore } from './localStorageViewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve, duplicateView } from './viewActions';
import { savedViewsStrings as s } from '$lib/i18n/saved-views-strings';

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
  duplicate(id: string): Promise<void>;
}

export function createViewController<T extends RowData>(args: {
  table: PortalTable<T>;
  listKey: string;
  store?: ViewStore;
  initialColumnsOnly?: boolean;
}): ViewController {
  const { table, listKey } = args;
  const store = args.store ?? localStorageViewStore;

  let views = $state<SavedViewRecord[]>([]);
  let activeId = $state<string | null>(null);

  const activeView = $derived(views.find((v) => v.id === activeId) ?? null);

  // Canonical-JSON compare of the live arrangement vs the active view. Guarded so
  // there is no `activeView.view` deref when nothing is active (spec FR-006).
  const isModified = $derived.by(() =>
    activeView ? serializeView(extractTableView(table)) !== serializeView(activeView.view) : false,
  );

  async function refresh() {
    views = await store.list(listKey);
  }

  async function init() {
    await refresh();
    const target = resolveInitialView(views, await store.getActiveId(listKey));
    if (target) {
      applyView(table, target.view, { columnsOnly: args.initialColumnsOnly, initial: true });
      activeId = target.id;
    }
  }

  async function select(id: string) {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    await applyAndActivate(store, table, listKey, v); // discards unsaved tweaks (FR-007)
    activeId = id;
  }

  async function saveAs(name: string) {
    const record = await createViewFrom(store, table, listKey, name, views.length === 0);
    await refresh();
    activeId = record.id;
  }

  async function save() {
    if (!activeView) return;
    await overwriteView(store, table, listKey, activeView.id);
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
    const result = await removeAndResolve(store, table, listKey, id, activeId === id, activeId);
    views = result.views;
    activeId = result.activeId;
  }

  async function setDefault(id: string) {
    await store.setDefault(listKey, id);
    await refresh();
  }

  async function duplicate(id: string) {
    const src = views.find((v) => v.id === id);
    if (!src) return;
    const record = await duplicateView(store, table, listKey, src, s.duplicateName(src.name));
    await refresh();
    activeId = record.id;
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
    duplicate,
  };
}
