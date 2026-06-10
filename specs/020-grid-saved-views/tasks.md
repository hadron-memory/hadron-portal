---
description: "Task list for Saved Views for the Unified Data Grid"
---

# Tasks: Saved Views for the Unified Data Grid

**Input**: Design documents from `specs/020-grid-saved-views/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/view-store.md, quickstart.md

**Tests**: MANDATORY per Constitution Principle I. The deterministic logic
(`savedView`, `ViewStore`, `viewController`) carries unit tests (≥80% line
coverage on new code) shipped in the same PR. The `ViewPicker` UI is verified
manually per `quickstart.md` (portal has a known component-test gap; logic is
tested through the controller with an in-memory store).

**Docs**: Per Principle II, a hadron-docs task is included (Polish phase).

**Entities**: No Entity Impact — v1 adds no platform entity (localStorage only),
so no `Entities.md` task (justified in plan.md).

**Organization**: Grouped by user story for independent implementation/testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (user-story phases only)

## Path Conventions

Single-repo SvelteKit frontend (`hadron-portal`); paths are repo-relative.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Create `src/lib/components/table/` directory and the i18n strings module `src/lib/i18n/saved-views-strings.ts` with `t()`-backed labels (`saved-views.save`, `.save-as`, `.reset`, `.rename`, `.delete`, `.set-default`, `.default-badge`, `.modified-badge`, `.name-prompt`, `.empty-save-as`, `.confirm-delete`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

- [ ] T002 [P] Extend `SavedView` in `src/lib/table/savedView.ts`: add `globalFilter: string`; update `extractView` to read `state.globalFilter`; update `deserializeView` to default `globalFilter` to `''`; add `applyView(table, view)` that sets sorting, columnFilters, globalFilter (`setGlobalFilter`), columnVisibility, columnOrder, and pagination resiliently.
- [ ] T003 [P] Extend `src/lib/table/table-logic.test.ts`: `globalFilter` survives extract→serialize→deserialize round-trip; `applyView` ignores unknown column/filter/sort ids without throwing; `serializeView` key order is stable. (after T002)
- [ ] T004 [P] Define `SavedViewRecord` type, `ViewStore` interface, `ViewStorageError`, name-validation constants, and `listKey` helpers in `src/lib/table/viewStore.ts` (per contracts/view-store.md).
- [ ] T005 Implement the localStorage `ViewStore` in `src/lib/table/localStorageViewStore.ts`: per-list keys (`hadron:views:v1:<listKey>`, `…:active:<listKey>`), one-default invariant in `setDefault`, active get/set, `crypto.randomUUID()` ids + ISO timestamps, name trim/empty-reject/length-cap (duplicates allowed), and `window`-guarded try-catch graceful degradation. (after T002, T004)
- [ ] T006 [P] Unit tests `src/lib/table/viewStore.test.ts`: create/list/get/update/remove; one-default invariant; active get/set; duplicate names allowed; empty/oversize name handling; reads return empty when storage unavailable; writes surface `ViewStorageError`. (after T005)
- [ ] T007 Implement runes controller `createViewController` in `src/lib/table/viewController.svelte.ts`: reactive `views`/`activeId`/`activeView`/`isModified`; `init()` resolution (active → default → built-in, client-only); `select(id)` (applyView + setActive, discards unsaved tweaks). Action stubs for saveAs/save/reset/rename/remove/setDefault filled in story phases. (after T002, T004, T005)
- [ ] T008 [P] Unit tests `src/lib/table/viewController.test.ts` (with an in-memory `ViewStore` fake): `init` resolves active→default→built-in; `isModified` is canonical-compare of current vs active; `select` applies + sets active. (after T007)
- [ ] T009 Create `src/lib/components/table/ViewPicker.svelte` shell: props `{ table, listKey, store? }` (store defaults to localStorage impl); instantiate the controller; call `controller.init()` in `onMount` (SSR-safe); render the active view name container; all strings via `t()`. (after T007, T001)
- [ ] T010 Add an optional `listKey?: string` prop to each grid list and render `<ViewPicker {table} {listKey} />` when set, near the search/page-size controls: `src/lib/components/NodeList.svelte`, `src/lib/components/AgentList.svelte`, `src/lib/components/NodeTable.svelte`, `src/routes/app/usage/sessions/+page.svelte`, `src/routes/app/usage/memory/+page.svelte`; pass the `listKey` from callers (`MemoryBrowser` → `memory:<memoryId>:nodes`; `agents`; `usage:sessions`; `usage:memory`). (after T009)

**Checkpoint**: Foundation ready — lists resolve & apply a remembered/default view; stories add the actions/UI.

---

## Phase 3: User Story 1 - Save an arrangement and have it come back (Priority: P1) 🎯 MVP

**Goal**: Save the current arrangement as a named view; it persists and reapplies on return (sticky active; default on first-ever open).

**Independent Test**: On a grid-backed list, arrange it, Save as "My view", reload + navigate away/back → list returns to that arrangement.

- [ ] T011 [US1] Implement `saveAs(name)` in `src/lib/table/viewController.svelte.ts`: create a record from `extractView(table.getState())`, set it active; if it is the first view for the list, also mark it default. (after T007)
- [ ] T012 [US1] Add the "Save current view as…" affordance + name prompt to `src/lib/components/table/ViewPicker.svelte`; empty state (no views) shows only this action. (after T009, T011)
- [ ] T013 [P] [US1] Extend `src/lib/table/viewController.test.ts`: `saveAs` creates + persists + sets active (+ default when first); after `saveAs`, a fresh `init` reapplies it (sticky) and applies default on a first-ever open. (after T011)
- [ ] T014 [US1] Manual verification per quickstart.md steps 1–3 (save, reload, sticky/default) on the memory browse node list.

**Checkpoint**: MVP — a user can save and auto-restore a view on every grid list.

---

## Phase 4: User Story 2 - Keep several named views and switch (Priority: P2)

**Goal**: Maintain multiple named views per list, switch between them, and mark a default.

**Independent Test**: Create three views, switch among them (each reapplies its arrangement), mark one default, reload → default applies on a fresh open.

- [ ] T015 [US2] Implement `setDefault(id)` in `src/lib/table/viewController.svelte.ts` (delegates to `store.setDefault`, enforcing one default). (after T007)
- [ ] T016 [US2] In `src/lib/components/table/ViewPicker.svelte`: render the list of views with the active one highlighted; selecting a view calls `controller.select`; add a "Set as default" action and a default indicator. (after T009, T015)
- [ ] T017 [P] [US2] Extend `src/lib/table/viewController.test.ts`: `select` applies the chosen view + updates active; `setDefault` enforces a single default; `init` applies default on fresh open and the active view when one is remembered. (after T015)
- [ ] T018 [US2] Manual verification per quickstart.md steps 2–4 (multiple views, switch, default).

**Checkpoint**: Users curate and switch among multiple per-list views.

---

## Phase 5: User Story 3 - See divergence and act on it (Priority: P2)

**Goal**: Show a "modified" indicator when the live arrangement diverges from the active view, with Save / Save as / Reset.

**Independent Test**: Select a view, tweak the sort → "modified" badge shows; Save persists the tweak; Reset reverts it; switching away while modified silently discards.

- [ ] T019 [US3] Implement `save()` (overwrite the active view's `view` from current state + bump `updatedAt`) and `reset()` (re-apply the active view to the table) in `src/lib/table/viewController.svelte.ts`. (after T007)
- [ ] T020 [US3] In `src/lib/components/table/ViewPicker.svelte`: show the "modified" badge from `controller.isModified`; add Save and Reset buttons (Save-as already present from US1); confirm switching while modified discards via the existing `select`. (after T012, T019)
- [ ] T021 [P] [US3] Extend `src/lib/table/viewController.test.ts`: `isModified` flips true after a tweak and false after `save`/`reset`; `save` persists; `reset` reverts to the active view. (after T019)
- [ ] T022 [US3] Manual verification per quickstart.md steps 5–6 (modified badge, Save, Reset, discard-on-switch).

**Checkpoint**: Users can trust what's saved vs unsaved and act on divergence.

---

## Phase 6: User Story 4 - Rename and delete views (Priority: P3)

**Goal**: Rename a view; delete one, with the list resolving to a valid arrangement.

**Independent Test**: Rename a view (persists, shows in picker); delete a view (gone, no longer applies); deleting the default leaves no default.

- [ ] T023 [US4] Implement `rename(id, name)` and `remove(id)` (plus re-resolution active → default → built-in) in `src/lib/table/viewController.svelte.ts`. (after T007)
- [ ] T024 [US4] In `src/lib/components/table/ViewPicker.svelte`: add rename and delete actions (delete with a confirm). (after T016, T023)
- [ ] T025 [P] [US4] Extend `src/lib/table/viewController.test.ts`: `rename` persists; `remove` deletes + re-resolves; deleting the active view falls back to default (else built-in); deleting the default leaves no default. (after T023)
- [ ] T026 [US4] Manual verification: rename and delete a view; confirm fallbacks (quickstart-style).

**Checkpoint**: Full view lifecycle (create/switch/default/rename/delete) on every grid list.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T027 [P] Reconcile the legacy `hadron:nodeList:pageSize` (D7): ensure the built-in default page size still seeds when no view is active and never conflicts with a view's page size; verify on `src/lib/components/NodeList.svelte`.
- [ ] T028 [P] i18n audit: confirm all `ViewPicker` strings and any touched-region strings on the 5 lists go through `src/lib/i18n/` `t()` (Principle III); no hardcoded user-facing literals introduced.
- [ ] T029 [P] Update hadron-docs: add a saved-views portal-usage page/section (what a view captures; save/switch/default/rename/delete; per-browser in v1) (Principle II / Docs Plan).
- [ ] T030 Run the full gate: `npx svelte-check` (0 errors), `pnpm vitest run src/lib/table` (green), `pnpm build` (clean).

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T010)** → **User Stories** → **Polish (T027–T030)**.
- Foundational internal order: T002→T003; T004→T005→T006; (T002,T004,T005)→T007→T008; (T007,T001)→T009→T010.
- **Story independence after foundation**: US1 (T011–T014), US2 (T015–T018), US3 (T019–T022), US4 (T023–T026) each touch the controller (different methods) + the picker (different sections) + the shared test file. They are logically independent slices and can be implemented in priority order; the only shared file (`viewController.svelte.ts` / its test) means same-file edits should be serialized even though the slices are independent.
- **Polish** after all stories.

## Parallel Opportunities

- **Foundational**: T002 and T004 are `[P]` (different files). Their tests T003/T006/T008 are `[P]` relative to each other once their impl lands.
- **Per story**: the unit-test task in each story (T013, T017, T021, T025) is `[P]` — different concern from the picker UI edit, though it shares the controller test file, so coordinate writes.
- **Polish**: T027, T028, T029 are `[P]` (different files/repos); T030 runs last.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)**: a user can save a named view that persists and auto-restores on every grid list. Ship/demo here.
- **Increment 2 = US2** (multiple views + switch + default).
- **Increment 3 = US3** (modified indicator + Save/Reset).
- **Increment 4 = US4** (rename/delete).
- **Polish** (legacy pageSize reconcile, i18n audit, docs, full gate) before the PR merges.

## MVP Scope

User Story 1 only (T001–T014): save + sticky/default auto-restore. Independently testable per quickstart.md steps 1–3.
