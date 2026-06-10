---
# Per Constitution "Implementation Scope": specs target repositories, not
# product brands or domains.
target-repositories:
  - hadron-portal
---

# Feature Specification: Saved Views for the Unified Data Grid

**Feature Branch**: `020-grid-saved-views`
**Created**: 2026-06-09
**Status**: Draft
**Input**: User description: "Saved views for the unified data grid — multiple named per-list views (filter, sort, columns, page size, search) persisted via a server-ready store abstraction with a localStorage implementation; personal-only v1; all grid-backed lists."

## Background

The portal's lists now all run on one grid engine (the TanStack-based grid
adopted in the data-grid bake-off; see `docs/grid-bakeoff.md`). A list's
arrangement — how it's sorted, filtered, searched, which columns are shown and
in what order, and the page size — is currently ephemeral: it resets on reload
and can't be named or reused. Data-heavy users re-create the same arrangements
repeatedly.

This feature lets a user **curate named "views"** per list: save the current
arrangement under a name, switch between several, pick one as the default that
auto-applies on load, and rename/delete them. A "view" already has a partial
model in the grid infra (`src/lib/table/savedView.ts`): a `SavedView` capturing
sort, column filters, column visibility, column order, and pagination. This
feature extends that model (notably to include the global search term), adds a
**store abstraction** for persistence, and adds a **reusable view-picker** wired
into every grid-backed list.

Fixed design decisions (from product review):

- **Hybrid storage.** v1 persists to the browser (localStorage), but all
  persistence sits behind a small store abstraction so a future per-user,
  server-backed store can replace it **without changing any list UI or the
  picker**. The view record is shaped to be server-ready (stable id, list key,
  name, timestamps, default flag).
- **Multiple named views per list**, with one markable as default.
- **Personal only** in v1 — a view is private to whoever created it. No
  org/team sharing yet, but the model must not preclude it.
- **All grid-backed lists** participate, via a stable per-list key scheme.

A planned **second step** (not this spec) will migrate the portal's remaining
non-grid lists onto the same grid widget; because the picker and store are
generic and keyed by an opaque list key, those lists gain saved views for free
once migrated. This spec must keep the picker/store list-agnostic so that holds.

## Clarifications

### Session 2026-06-09

- Q: After selecting a non-default view and reloading, what does the list show? → A: The last-selected view (sticky) — the active view is remembered per browser and reapplied on reload; the default applies only on the first-ever visit before any selection.
- Q: Must view names be unique within a list? → A: Allow duplicates — names are free-text labels; views are identified by a stable id.
- Q: When a view has unsaved tweaks and the user switches to a different view, what happens to the tweaks? → A: Silently discard them and apply the selected view (the "modified" badge is the warning).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save an arrangement and have it come back (Priority: P1)

A user sorts/filters/searches a list, hides a couple of columns, sets a page
size, then saves that arrangement as a named view. On their next visit the list
opens already in that arrangement.

**Why this priority**: This is the core value and a viable MVP on its own —
even a single named, auto-restoring view per list eliminates the repeated
re-configuration that motivates the feature.

**Independent Test**: On any grid-backed list, arrange it, save as "My view",
reload the page (and navigate away and back) — the list reappears in the saved
arrangement.

**Acceptance Scenarios**:

1. **Given** a list with a custom sort, search term, hidden column, and page
   size, **When** the user saves it as a named view, **Then** that view becomes
   the active view and reloading the page reopens the list in exactly that
   arrangement.
2. **Given** a saved view, **When** the user changes the live arrangement
   without saving and reloads, **Then** the list reopens in the saved view's
   arrangement (unsaved changes are discarded), not the last live state.

---

### User Story 2 - Keep several named views and switch between them (Priority: P2)

A user maintains multiple arrangements of the same list (e.g. "Tasks by date",
"Recently edited", "All A–Z") and switches between them from a picker.

**Why this priority**: Multiple views are the differentiated capability beyond a
single sticky arrangement, but the feature already delivers value with one view
(P1), so this layers on top.

**Independent Test**: Create three named views on one list, switch among them
via the picker, and confirm each reapplies its full arrangement; confirm the
chosen default is the one applied on a fresh load.

**Acceptance Scenarios**:

1. **Given** several saved views for a list, **When** the user selects a
   different view in the picker, **Then** the list immediately re-arranges to
   that view and the picker shows it as active.
2. **Given** one view is marked default and the user has never selected a view
   on this list, **When** the user opens the list fresh, **Then** the default
   view is applied.
3. **Given** the user marks a different view as default, **When** they reload,
   **Then** the newly chosen default is applied and only one view is default.
4. **Given** the user previously selected a non-default view, **When** they
   reload or return to the list later, **Then** the last-selected (active) view
   is reapplied rather than the default (sticky active view).

---

### User Story 3 - See when the live arrangement diverges, and act on it (Priority: P2)

After selecting a view, the user tweaks the arrangement. The picker shows a
"modified" indicator and offers Save (update the active view), Save as (create a
new view), and Reset (revert to the active view).

**Why this priority**: Without a divergence indicator and these actions, users
can't tell whether their tweaks are captured, which undermines trust in the
feature. It's essential UX but depends on P1/P2 existing first.

**Independent Test**: Select a view, change the sort, confirm the "modified"
badge appears; use Save and confirm the view now reopens with the change; repeat
and use Reset and confirm the change is discarded.

**Acceptance Scenarios**:

1. **Given** an active saved view, **When** the live arrangement differs from it
   in any captured dimension, **Then** a "modified" state is shown.
2. **Given** a modified state, **When** the user chooses Save, **Then** the
   active view is updated to the live arrangement and "modified" clears.
3. **Given** a modified state, **When** the user chooses Save as and names it,
   **Then** a new view is created, becomes active, and the prior view is
   unchanged.
4. **Given** a modified state, **When** the user chooses Reset, **Then** the
   live arrangement reverts to the active view and "modified" clears.

---

### User Story 4 - Rename and delete views (Priority: P3)

A user renames a view or deletes one they no longer want.

**Why this priority**: Housekeeping — valuable for long-term use but not needed
to prove the concept.

**Independent Test**: Rename a view and confirm the new name shows in the
picker and persists across reload; delete a view and confirm it's gone and no
longer applies.

**Acceptance Scenarios**:

1. **Given** a saved view, **When** the user renames it, **Then** the new name
   persists and appears in the picker.
2. **Given** the active view is deleted, **When** the deletion completes,
   **Then** the list falls back to the default view (or to the list's built-in
   default arrangement if none remains) and the picker reflects this.
3. **Given** the default view is deleted, **When** the deletion completes,
   **Then** no view is marked default until the user sets a new one.

---

### Edge Cases

- **No views yet**: a list with zero saved views shows an unobtrusive picker
  offering only "Save current view as…", and uses the list's built-in default
  arrangement.
- **Storage unavailable/full**: if browser storage is disabled or full, the list
  still works (live arrangement only); save attempts surface a clear,
  non-blocking message rather than failing silently or crashing.
- **Stale arrangement (schema drift)**: a stored view may reference a column or
  filter that no longer exists (e.g. a column was removed/renamed). Applying it
  must ignore the unknown parts and apply the rest — never break the list.
- **Deleting the active or default view**: covered in US4; the list must always
  resolve to a valid arrangement.
- **Duplicate / empty / very long names**: naming rules must be defined (see
  FRs) so the picker stays usable.
- **Cross-list isolation**: a view saved for one list never appears on or
  applies to another; keys are per-list.
- **Switching with unsaved tweaks**: selecting another view while the current
  one is modified silently discards the tweaks (per FR-007); no confirm dialog.
- **Multiple tabs**: changes made in one browser tab should not corrupt views;
  last-write-wins per view is acceptable for v1.
- **Existing page-size preference**: the per-list page-size already persisted
  (the `hadron:nodeList:pageSize` behavior from the pagination work) must be
  reconciled so it doesn't conflict with a view's captured page size.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (List key)**: The system MUST identify each list by a stable,
  human-meaningful **list key** so views are scoped per list. The scheme MUST
  cover all grid-backed lists and be derivable without ambiguity, e.g.
  `memory:<memoryId>:nodes`, `agents`, `usage:sessions`, `usage:memory`. Keys
  that embed an entity id (e.g. a memory) scope views to that entity.
- **FR-002 (Captured state)**: A view MUST capture the full user-controllable
  arrangement: sort, per-column filters, **global search term**, column
  visibility, column order, and page size. (Today's per-list arrangement state
  does not persist the global search term; the captured-state model must be
  extended to include it.)
- **FR-003 (Save as named view)**: Users MUST be able to save the current
  arrangement as a new named view for the current list.
- **FR-004 (List & switch)**: Users MUST be able to see all views for the
  current list and switch the active view; switching MUST immediately apply that
  view's arrangement.
- **FR-005 (Default view)**: Users MUST be able to mark exactly one view per
  list as the default. The default MUST auto-apply on the **first-ever** open of
  that list (when no active view has been remembered yet) and serves as the
  fallback when the remembered active view is deleted. At most one default
  exists per list key.
- **FR-005a (Sticky active view)**: The system MUST remember the **last-selected
  (active) view** per list key and reapply it on reload and on return to the
  list, taking precedence over the default once the user has selected any view.
  The remembered active view persists with the same scope as the views
  themselves (local browser profile in v1).
- **FR-006 (Modified detection)**: The system MUST detect when the live
  arrangement diverges from the active view in any captured dimension and
  reflect this as a "modified" state.
- **FR-007 (Save / Save as / Reset)**: In a modified state, users MUST be able
  to Save (overwrite the active view), Save as (create a new view), or Reset
  (revert the live arrangement to the active view). Switching to a different view
  while in a modified state MUST silently discard the unsaved tweaks and apply
  the selected view (the "modified" indicator is the only warning).
- **FR-008 (Rename)**: Users MUST be able to rename a view.
- **FR-009 (Delete)**: Users MUST be able to delete a view; the list MUST then
  resolve to a valid arrangement (default view, else the list's built-in
  default).
- **FR-010 (Persistence)**: Saved views MUST persist across page reloads and
  navigation within the same browser profile.
- **FR-011 (Store abstraction)**: All persistence MUST go through a single store
  abstraction with operations to list/get/create/update/delete views and
  get/set the default for a list key. The list UIs and the picker MUST depend
  only on this abstraction, so a future server-backed implementation can replace
  the localStorage one without changing them.
- **FR-012 (Server-ready records)**: Each view record MUST carry a stable
  identifier, its list key, a name, created/updated timestamps, and a default
  flag, so the same record shape can later be stored per-user on the server.
- **FR-013 (Resilient apply)**: Applying a view MUST tolerate parts that no
  longer match the list (unknown column, filter, or sort target) by ignoring
  those parts and applying the rest, without error.
- **FR-014 (Reusable picker)**: The view-picker MUST be a single reusable
  component parameterized by list key, usable on any grid-backed list (including
  lists migrated onto the grid in the future) without per-list code beyond
  supplying the key.
- **FR-015 (Naming rules)**: View names MUST be non-empty and trimmed and capped
  at **100 characters** so the picker stays usable. Duplicate names within a list
  key ARE allowed — views are identified by a stable id, not by name.
- **FR-016 (Scope/privacy)**: In v1, views are scoped to the local browser
  profile and are not shared or synced across devices or users; the model MUST
  NOT preclude a later per-user, server-synced, or shareable scope.

### Out of Scope (v1)

- Server-side persistence (only the abstraction plus a localStorage
  implementation; no hadron-server entity or API in this spec).
- Sharing views with an organization or team.
- Migrating non-grid lists onto the grid (a separate, second-step effort) and
  row virtualization.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can save the current arrangement and, after a reload and a
  navigate-away-and-back, find the list restored to that arrangement with **zero
  manual re-configuration**.
- **SC-002**: Switching the active view re-arranges the list **immediately**
  (perceived as instant; under ~1 second on a list of typical size).
- **SC-003**: A returning user lands on their last-selected view on **100%** of
  reloads/returns; the default view is applied on the first-ever open (before
  any selection) on **100%** of such opens.
- **SC-004**: Saved views work uniformly on **all** grid-backed lists (memory
  browse nodes, agents, node tables, and both usage tables) with no list
  reporting unsupported behavior.
- **SC-005**: A stored view that references a removed/renamed column or filter
  **never breaks the list** — the list still renders and applies the remaining
  valid settings in **100%** of such cases.
- **SC-006**: When the live arrangement differs from the active view, the
  "modified" state is shown in **100%** of divergence cases and clears after
  Save or Reset.
- **SC-007**: Replacing the underlying storage mechanism with an alternative
  requires **no changes** to any list or the view-picker — the persistence layer
  is the only part that changes.

## Assumptions

- **Grid foundation in place**: every targeted list already runs on the unified
  grid with controllable sort/filter/search/column-visibility/column-order/
  page-size; this feature reads and writes that state, it does not add grid
  capabilities.
- **`SavedView` model reused and extended**: the existing
  `src/lib/table/savedView.ts` model and its serialize/rehydrate helpers are the
  starting point; the global search term is added to the captured state.
- **Personal, per-browser scope for v1**: acceptable that views don't follow a
  user across devices/browsers in v1; the server-backed store is a later step
  that reuses the same record shape and store interface.
- **Reconcile existing page-size persistence**: the standalone per-list
  page-size preference is folded into the view model (a view captures page
  size); any standalone key is reconciled to avoid conflicting with a view.
- **No new backend**: v1 touches only the portal; no hadron-server schema, API,
  or Entities.md change. A future server-backed step would add an entity then.
- **Second-step grid migration is independent**: additional lists will be moved
  onto the grid separately; keeping the picker/store list-agnostic ensures they
  inherit saved views without rework.
