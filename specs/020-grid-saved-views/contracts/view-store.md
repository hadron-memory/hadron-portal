# Contract: ViewStore, ViewController, and ViewPicker

This feature is internal to the portal (no external API). The "contracts" are the
in-repo interfaces that keep the UI decoupled from persistence (SC-007) and keep
the picker list-agnostic (FR-014). These are the stable seams; the localStorage
impl is replaceable.

## `ViewStore` — persistence seam (`src/lib/table/viewStore.ts`)

The single dependency for persistence. The localStorage impl is the v1 concrete
type; a server-backed impl must satisfy the same interface. Operations are async
to allow a future networked impl without changing callers.

```ts
export interface SavedViewRecord {
  id: string;
  listKey: string;
  name: string;
  view: SavedView;          // from savedView.ts (now incl. globalFilter)
  isDefault: boolean;
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
}

export interface ViewStore {
  list(listKey: string): Promise<SavedViewRecord[]>;
  get(listKey: string, id: string): Promise<SavedViewRecord | null>;
  create(listKey: string, name: string, view: SavedView): Promise<SavedViewRecord>;
  update(listKey: string, id: string, patch: Partial<Pick<SavedViewRecord, 'name' | 'view' | 'isDefault'>>): Promise<SavedViewRecord>;
  remove(listKey: string, id: string): Promise<void>;

  getDefault(listKey: string): Promise<SavedViewRecord | null>;
  setDefault(listKey: string, id: string | null): Promise<void>; // enforces ≤1 default

  getActiveId(listKey: string): Promise<string | null>;
  setActiveId(listKey: string, id: string | null): Promise<void>;
}
```

**Behavioral contract**
- `setDefault` MUST clear `isDefault` on all other records for the `listKey`
  (one-default invariant).
- `create` MUST trim the name, reject empty (throw a typed error), cap length,
  and allow duplicate names.
- All methods MUST NOT throw on unavailable storage for *reads* (return empty/
  null); *writes* MAY surface a typed `ViewStorageError` the UI shows
  non-blockingly.
- `remove` of the active id MUST clear or re-resolve the active pointer (caller
  re-resolves via the controller).

## `createViewController` — reactive glue (`src/lib/table/viewController.svelte.ts`)

Runes controller binding a `table` instance + `listKey` + `ViewStore`. Holds the
reactive UI state and the actions; this is where the testable logic lives.

```ts
export interface ViewController {
  readonly views: SavedViewRecord[];      // reactive
  readonly activeId: string | null;        // reactive
  readonly activeView: SavedViewRecord | null;
  readonly isModified: boolean;            // reactive: canonical-compare current vs active

  init(): Promise<void>;                    // load views, resolve & apply (active → default → built-in)
  select(id: string): Promise<void>;        // apply view, set active (discards unsaved tweaks)
  saveAs(name: string): Promise<void>;      // create from current state, become active
  save(): Promise<void>;                     // overwrite active view with current state
  reset(): void;                             // re-apply active view to the table
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;         // delete + re-resolve (default → built-in)
  setDefault(id: string): Promise<void>;
}

export function createViewController(args: {
  table: Table<unknown>;
  listKey: string;
  store: ViewStore;
}): ViewController;
```

**Resolution contract (`init`)**: apply remembered `activeId` view → else the
default view → else leave the list's built-in arrangement untouched. `init` runs
client-side (onMount), never during SSR/init.

**`isModified` contract**: `serializeView(extractView(table.getState())) !==
serializeView(activeView.view)`; `false` when there is no active view.

## `ViewPicker.svelte` — UI (`src/lib/components/table/ViewPicker.svelte`)

```ts
interface Props {
  table: Table<unknown>;       // the grid instance to read/apply state on
  listKey: string;             // which list these views belong to
  store?: ViewStore;           // defaults to the localStorage impl
}
```

**UI contract**
- Renders a view selector (active view name; "modified" badge when dirty), and
  actions: Save, Save as…, Reset, Rename, Delete, Set default.
- Empty state (no views): only "Save current view as…" is offered.
- All strings via `t('saved-views.*', default)` (Principle III).
- The picker depends ONLY on `table`, `listKey`, and `ViewStore` — no per-list
  knowledge (FR-014). Swapping the store implementation requires no change here
  (SC-007).

## List integration contract

Each grid-backed list gains an optional `listKey?: string` prop and renders
`<ViewPicker {table} {listKey} />` when it is set; absent `listKey` ⇒ no picker,
behavior unchanged. Callers (pages) own the `listKey` value per the scheme in
data-model.md.
