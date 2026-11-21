// Runes controller binding a grid `table` + `listKey` + `ViewStore` (spec 020).
// Holds the reactive picker state and the actions; this is the testable logic
// (the ViewTabs component is a thin shell over it).
import type { PortalTable } from '$lib/table/features';
import type { RowData } from '@tanstack/table-core';
import { extractView, extractTableView, applyView, serializeView, mergeMissingColumns } from './savedView';
import { type ViewStore, type SavedViewRecord, resolveInitialView } from './viewStore';
import { localStorageViewStore } from './localStorageViewStore';
import { createViewFrom, overwriteView, applyAndActivate, removeAndResolve, duplicateView, persistMergeBestEffort } from './viewActions';
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
    const resolved = resolveInitialView(views, await store.getActiveId(listKey));
    if (resolved) {
      // portal#2253 item 4: migrate a stored arrangement that predates a
      // column (the missing id merges in at its default position) and persist
      // the merge, so the view applies cleanly and never reads as permanently
      // modified. The persist is BEST-EFFORT (portal#2274 P2): a quota-full
      // store throws on write, and that must not stop the mount from applying
      // the merged arrangement — the same fallback migrateStoredView uses, via
      // the shared helper. The no-op path stays SYNCHRONOUS — every list mounts
      // through here, and one extra await shifts mount timing for all of them
      // (picker-inner-layers pinned the old hop count).
      let target = resolved;
      const merged = mergeMissingColumns(
        table.getAllLeafColumns().map((c) => c.id),
        resolved.view.columnOrder,
      );
      if (merged !== resolved.view.columnOrder) {
        target = await persistMergeBestEffort(store, listKey, resolved, { ...resolved.view, columnOrder: merged });
        views = views.map((v) => (v.id === target.id ? target : v));
      }
      applyView(table, target.view, { columnsOnly: args.initialColumnsOnly, initial: true });
      activeId = target.id;
    }
  }

  async function select(id: string) {
    const current = views.find((x) => x.id === id);
    if (!current) return;
    // applyAndActivate migrates and returns the merged record; swapping it
    // into local state keeps isModified comparing against the merged
    // arrangement, not the pre-merge stored one — one migrate per select,
    // not two (portal#2274 P3).
    const v = await applyAndActivate(store, table, listKey, current); // discards unsaved tweaks (FR-007)
    if (v !== current) views = views.map((x) => (x.id === id ? v : x));
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
