# Implementation Plan: Saved Views for the Unified Data Grid

**Branch**: `020-grid-saved-views` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/020-grid-saved-views/spec.md`

## Summary

Add **named, per-list saved views** to the portal's unified TanStack grid. A
view captures a list's full arrangement — sort, per-column filters, global
search, column visibility, column order, and page size — as a plain object. v1
persists views to the browser behind a **`ViewStore` abstraction** (localStorage
implementation), so a future per-user, server-backed store can replace it
without touching any list UI. A single reusable **`ViewPicker`** component, given
a grid `table` instance and an opaque `listKey`, drives save / save-as / switch /
rename / delete / set-default and shows a "modified" indicator. The active view
is **sticky** (remembered per list, reapplied on reload); the default applies
only on first-ever open and as the deletion fallback.

Technical approach: extend `src/lib/table/savedView.ts` (add `globalFilter` to
`SavedView`, add a resilient `applyView(table, view)`), add `ViewStore` +
localStorage impl + a runes `viewController`, and a `ViewPicker.svelte`. Wire it
into the five grid-backed lists by passing a `listKey`.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5 (runes), SvelteKit 2
**Primary Dependencies**: `@tanstack/table-core` + in-repo runes adapter (`src/lib/table/*`); no new dependency
**Storage**: Browser `localStorage` in v1, behind a `ViewStore` interface (server-backed impl is a later, out-of-scope step)
**Testing**: Vitest (headless unit tests for store + controller + savedView helpers); no DOM required for logic
**Target Platform**: Portal web app (client-side; SSR-safe — storage access guarded to client)
**Project Type**: Web application frontend (SvelteKit), single repo `hadron-portal`
**Performance Goals**: View switch perceived instant (<~1s on typical lists, hundreds of rows already client-side)
**Constraints**: SSR-safe (no `localStorage` during SSR/init → no hydration mismatch); resilient apply (unknown column/filter ignored); no backend
**Scale/Scope**: 5 grid-backed lists today; design list-agnostic so future grid-migrated lists inherit it for free

No unresolved NEEDS CLARIFICATION — the three open decisions were resolved in the spec's Clarifications session (sticky active view, duplicate names allowed, discard-on-switch).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principles

- **I. Pragmatic Test-First** — Store, controller, and `savedView` extract/apply/serialize are deterministic and unit-tested headlessly (see Test Plan). MVP (US1) ships with tests first.
- **II. Docs-Concurrent** — No portal **routes** added/renamed (component + lib only), so the README route table is unchanged. No auth/env/sidebar-mode change. User-facing behavior is new, so a hadron-docs portal-usage note is listed in the Docs Plan.
- **III. Accessible to Non-Technical Readers** — All new `ViewPicker` strings go through `src/lib/i18n/t.ts` with stable hierarchical ids (`saved-views.*`). Integration touches existing list components minimally; any strings in the immediate edited region are migrated per the touched-component rule.
- **IV. Brainstorm → Spec → Implement** — Exempt: this spec originates from an in-session product-decision thread (the data-grid initiative), not a standalone brainstorming doc; the decisions are captured in spec Background + Clarifications.
- **V. Zero-Trust Apps** — N/A for the trust boundary: views are personal client-side preferences with no authorization decision and no GraphQL mutation. No server data is read/written. (A future server-backed store would add `+server.ts`/proxy + server authz then.)

### Technology Invariants

- **1. Node schema / 2. nodeTypes / 3. Edge ownership / 7. Memory storage / 10. Memory portability** — N/A (no nodes/edges/memory storage touched).
- **4. UUIDv7 IDs** — N/A: view ids are client-local identifiers (`crypto.randomUUID()`), not platform entities created server-side. No time-sortable platform id is minted.
- **5. Client transport (MCP + GraphQL) / 11. GraphQL API stability** — N/A (no client-facing API surface; no GraphQL).
- **9. Language/runtime** — Honored: no stack change (P1 stack pin respected).
- **P1. Stack pin** — Honored: SvelteKit 2 + Svelte 5 runes + Tailwind v4 + TS strict; no new framework/runtime.
- **P2. GraphQL access locality** — N/A (no `graphql-request` use; localStorage only).
- **P3. Type-driven UI** — Honored: the view's captured column ids derive from the grid's typed column defs; the picker is generic over the `table` instance rather than hardcoding per-list columns.
- **P4. Markdown sanitization / P5. Consumer-mode / P6. Marketplace intent** — N/A.

### Verdict

- [x] All applicable **design** items honored. No Complexity Tracking entries.
- [x] **Process item — spec location: RESOLVED.** The portal constitution's
  Spec Workflow currently says portal specs live under `spec-kits/specs/NNN-name/`
  and that `hadron-portal` MUST NOT host its own `specs/` directory. The
  maintainer has confirmed the constitution is **incorrect** on this point and
  will amend it to permit in-repo specs; this spec stays at
  `specs/020-grid-saved-views/`. Constitution amendment tracked separately by the
  maintainer.

## Test Plan *(per Principle I)*

### Unit tests (deterministic code)
- `savedView`: extend round-trip test to cover `globalFilter`; `applyView` ignores unknown column/filter/sort ids (resilience, SC-005); `serializeView` stable key order (modified-detection basis).
- `ViewStore` (localStorage impl): create/list/get/update/delete; one-default invariant; get/set active id; duplicate names allowed; empty/oversize name handling (FR-015); storage-unavailable path degrades gracefully (no crash).
- `viewController`: active-view resolution (sticky active → else default → else built-in), `isModified` computation, save / save-as / reset / delete fallback transitions.
- Target ≥80% line coverage on new `src/lib/table/*` modules.

### Evaluation tests (LLM-driven code)
- N/A — no LLM-powered behavior.

### Integration tests (contract boundaries)
- N/A for server contracts (no MCP/GraphQL boundary crossed). The store interface is exercised via its unit tests; a future server-backed impl would add integration tests then.

## Repos & PRs

| Repo | Branch (planned) | Notes |
|---|---|---|
| `hadron-portal` | `020-grid-saved-views` | All implementation: `src/lib/table/*` additions, `ViewPicker.svelte`, wiring into the 5 lists, i18n strings, tests. |
| `hadron-docs` | `docs/020-grid-saved-views` | Short portal-usage note for saved views (or fold into an existing grid/list page). |

No `hadron-server` / `hadron-concept` rows — v1 adds no entity/API; Entities.md untouched.

## Docs Plan *(per Principle II)*

- [ ] `hadron-docs/<portal usage>/saved-views.md` (or a section in the existing lists/browse page) — what a view captures, how to save/switch/default/rename/delete, and that views are per-browser in v1.

No portal route/auth/env/sidebar change → no README update required.

## Project Structure

### Documentation (this feature)

```text
specs/020-grid-saved-views/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── view-store.md     # ViewStore + ViewPicker + listKey contract
└── checklists/
    └── requirements.md   # from /speckit-specify
```

### Source Code (repository root)

```text
src/lib/table/
├── savedView.ts                 # EXTEND: add globalFilter to SavedView; add applyView(table, view)
├── viewStore.ts                 # NEW: SavedViewRecord type + ViewStore interface + listKey helpers
├── localStorageViewStore.ts     # NEW: localStorage implementation of ViewStore (the v1 store)
├── viewController.svelte.ts     # NEW: runes controller — reactive {views, activeId, isModified} + actions
├── table-logic.test.ts          # EXTEND: current saved-view tests live here; add globalFilter + applyView coverage
├── viewStore.test.ts            # NEW
└── viewController.test.ts       # NEW

src/lib/components/table/
└── ViewPicker.svelte            # NEW: reusable picker UI (props: table, listKey[, store])

src/lib/i18n/
└── saved-views-strings.ts       # NEW: t()-backed strings for the picker

# Integration (add a `listKey` prop; render <ViewPicker> when provided):
src/lib/components/NodeList.svelte           # listKey memory:<id>:nodes (from MemoryBrowser/page)
src/lib/components/AgentList.svelte          # listKey from caller (e.g. agents / org:<id>:agents)
src/lib/components/NodeTable.svelte          # listKey from caller
src/routes/app/usage/sessions/+page.svelte   # listKey usage:sessions
src/routes/app/usage/memory/+page.svelte     # listKey usage:memory
```

**Structure Decision**: Single-repo SvelteKit frontend. All logic lives in
`src/lib/table/*` (testable headlessly), UI in `src/lib/components/table/
ViewPicker.svelte`, wired into existing lists by passing an opaque `listKey`.
The store is the only persistence dependency (SC-007), so swapping localStorage
for a server-backed impl later requires no UI changes.

## Complexity Tracking

No Constitution violations — table intentionally empty.
