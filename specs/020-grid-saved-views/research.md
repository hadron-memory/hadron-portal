# Phase 0 Research: Saved Views for the Unified Data Grid

The spec's Clarifications session removed the product unknowns. The remaining
items are technical design decisions; each is resolved below.

## D1 — Capturing the global search term in a view

**Decision**: Add `globalFilter: string` to `SavedView`; `extractView` reads it
from `table.getState().globalFilter`, and `applyView` sets it via
`table.setGlobalFilter(view.globalFilter ?? '')`.

**Rationale**: The lists hold the search term in a component `$state` mirrored
into table state through a getter + `onGlobalFilterChange`. Because
`table.setGlobalFilter` flows back through `onGlobalFilterChange`, applying a
view updates the component's own `globalFilter` variable too — so the picker can
operate purely on the `table` instance and stay list-agnostic. Spec FR-002
requires search to be part of a view.

**Alternatives considered**: Keep search ephemeral (rejected — users expect a
saved "view" to include what they searched). Have the picker reach into each
list's component state (rejected — breaks list-agnosticism / FR-014).

## D2 — Resilient apply when a view references a stale column/filter

**Decision**: Rely on table-core tolerating unknown ids — `setColumnVisibility`,
`setColumnOrder`, `setColumnFilters`, and `setSorting` with ids that no longer
exist are ignored by the engine and do not throw. `applyView` sets each slice
defensively (coercing to safe defaults via the existing `deserializeView`
validation) and never assumes a column exists.

**Rationale**: Satisfies FR-013 / SC-005 (a removed column never breaks a list)
without per-list schema awareness.

**Alternatives considered**: Filter each slice against the live column ids before
applying (rejected for v1 — extra coupling; the engine already no-ops unknown
ids; revisit only if a real misrender appears).

## D3 — Modified-state detection

**Decision**: `isModified = serializeView(extractView(table.getState())) !==
serializeView(activeView.view)`. `extractView` builds the object with a fixed
key order, so `serializeView` (JSON.stringify) is a stable canonical form.

**Rationale**: A single canonical-string compare covers all captured dimensions
(FR-006) and is cheap and reactive (reading `table.getState()` re-runs through
the runes adapter). No deep-equal dependency.

**Alternatives considered**: Per-slice deep equality (rejected — more code, same
result). Dirty-flag on every grid event (rejected — brittle; canonical compare
is self-correcting, e.g. sort A→B→A reads as unmodified).

## D4 — Sticky active view (clarified) + default resolution

**Decision**: The store persists, per `listKey`: (a) the set of view records and
(b) a single `activeViewId`. On list open the controller resolves the arrangement
as: **remembered active view → else the default view → else the list's built-in
arrangement** (no view applied). Selecting/saving a view sets `activeViewId`.

**Rationale**: Implements the clarified sticky behavior (FR-005a) with the
default as first-open/fallback (FR-005). `activeViewId` is small, list-scoped
state alongside the records.

## D5 — View identifiers and timestamps

**Decision**: View ids are `crypto.randomUUID()` (client-local). `createdAt`/
`updatedAt` are ISO strings (`new Date().toISOString()`). Records carry
`id, listKey, name, view, isDefault, createdAt, updatedAt`.

**Rationale**: Server-ready record shape (FR-012). These are browser-local
identifiers, not platform entities, so Invariant 4 (UUIDv7, server-minted
time-sortable ids) does not apply — a UUIDv4 is fine. A later server store can
reissue ids/timestamps server-side.

## D6 — localStorage layout & SSR safety

**Decision**: Keys are namespaced and per-list:
`hadron:views:v1:<listKey>` → JSON array of view records;
`hadron:views:v1:active:<listKey>` → active view id.
All access is guarded (`typeof window !== 'undefined'` / try-catch). The
controller applies the resolved view in `onMount` (client-only), never during
component init — mirroring the #275 page-size fix to avoid hydration mismatch.

**Rationale**: SSR-safe, per-list isolation (FR — cross-list isolation), graceful
degradation when storage is disabled/full (return empty / surface a non-blocking
message).

**Alternatives considered**: One big blob for all lists (rejected — bigger
read/writes, cross-list coupling). IndexedDB (rejected — overkill for small
preference data; localStorage is synchronous and simple).

## D7 — Reconciling the existing `hadron:nodeList:pageSize`

**Decision**: Views own page size. The legacy `hadron:nodeList:pageSize` key
continues to seed the **built-in default** page size when no view is active;
once a view is applied, the view's page size wins. No destructive migration; the
legacy key may be retired in a later cleanup.

**Rationale**: Avoids a migration step and a conflicting source of truth while
preserving existing behavior for users who have no saved views yet.

## D8 — Integration surface on the five lists

**Decision**: Each grid list accepts an optional `listKey` prop and, when set,
renders `<ViewPicker {table} {listKey} />` near its search/page-size controls.
Pages compute the `listKey` (e.g. `memory:<memoryId>:nodes`). Lists without a
`listKey` behave exactly as today (picker absent).

**Rationale**: Minimal, uniform touch per FR-014; keeps the picker reusable and
lets the planned second-step grid migrations adopt views by just supplying a key.

## i18n note (Principle III)

All picker strings go through `t(id, default)` with `saved-views.*` ids. The
integration edits to existing lists are minimal (add a prop + render the picker);
strings within the immediately edited region are migrated as part of the change.

## Summary of decisions

| # | Decision |
|---|---|
| D1 | Add `globalFilter` to `SavedView`; apply via `table.setGlobalFilter` |
| D2 | Resilient apply leans on table-core ignoring unknown ids |
| D3 | Modified = canonical JSON compare of current vs active view |
| D4 | Resolve active → default → built-in; persist `activeViewId` per list |
| D5 | `crypto.randomUUID()` ids; ISO timestamps; server-ready record |
| D6 | Per-list namespaced localStorage keys; client-only apply (SSR-safe) |
| D7 | Views own page size; legacy pageSize key seeds built-in default only |
| D8 | Each list takes a `listKey` prop and renders the shared `ViewPicker` |
