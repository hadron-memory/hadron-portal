# Phase 1 Data Model: Saved Views

All structures are client-side (TypeScript types persisted to localStorage in
v1). No database/Prisma entity is added; the shapes are designed so a future
server store can adopt them with minimal change.

## `SavedView` (the captured arrangement) — extends existing `src/lib/table/savedView.ts`

The serializable arrangement of a list. **Extended** to include the global
search term.

| Field | Type | Notes |
|---|---|---|
| `sorting` | `SortingState` | TanStack sort state (single-sort in current lists) |
| `columnFilters` | `ColumnFiltersState` | per-column filters (mostly unused today, kept for completeness) |
| `globalFilter` | `string` | **NEW** — the search box term |
| `columnVisibility` | `VisibilityState` | shown/hidden columns |
| `columnOrder` | `ColumnOrderState` | column order |
| `pagination` | `PaginationState` | `{ pageIndex, pageSize }` |

Validation (in `deserializeView`): each slice falls back to a safe default when
malformed (already implemented; extend to `globalFilter` defaulting to `''`).
Key order is fixed so `serializeView` is a canonical form (used by
modified-detection).

## `SavedViewRecord` (the stored, named view) — NEW (`src/lib/table/viewStore.ts`)

A named, persisted wrapper around a `SavedView`.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `crypto.randomUUID()`; stable identity (names may duplicate) |
| `listKey` | `string` | which list this view belongs to (see List Key Scheme) |
| `name` | `string` | user label; non-empty, trimmed, length-capped; duplicates allowed |
| `view` | `SavedView` | the captured arrangement |
| `isDefault` | `boolean` | at most one `true` per `listKey` |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |

**Invariants**
- At most one record per `listKey` has `isDefault = true`.
- `id` is unique within a `listKey` (globally unique in practice).
- Records are scoped to a `listKey`; no record applies to another list.

**Lifecycle**: created (Save as) → updated (Save / Rename / Set-default) →
deleted. Deleting the active or default record triggers re-resolution
(active → default → built-in).

## Per-list active pointer — NEW

| Field | Type | Notes |
|---|---|---|
| `activeViewId` | `string \| null` | the sticky last-selected view for a `listKey`; `null` before any selection |

Stored per `listKey`. Drives sticky reload behavior (FR-005a).

## List Key Scheme (FR-001)

`listKey` is an opaque, stable string the caller supplies. Canonical forms:

| List | `listKey` |
|---|---|
| Memory browse node list (`NodeList`) | `memory:<memoryId>:nodes` |
| Agents list (`AgentList`) | `agents` (or `org:<orgId>:agents` if scoped per org by the caller) |
| Generic node table (`NodeTable`) | caller-defined, e.g. `<context>:nodes` |
| Sessions usage table | `usage:sessions` |
| Memory usage table | `usage:memory` |

Keys embedding an entity id (e.g. a memory) scope views to that entity, so each
memory gets its own views. The component never invents the key — it is a prop.

## Storage layout (localStorage v1)

| Key | Value |
|---|---|
| `hadron:views:v1:<listKey>` | JSON array of `SavedViewRecord` |
| `hadron:views:v1:active:<listKey>` | `activeViewId` string |

All reads/writes are `window`-guarded and try-catch wrapped (graceful when
storage is unavailable/full). Legacy `hadron:nodeList:pageSize` is left intact
and used only as the built-in default page size when no view is active (D7).

## Relationships

```text
listKey ──< SavedViewRecord (0..n)        # many views per list
listKey ──  activeViewId (0..1)           # one sticky active pointer per list
SavedViewRecord ── view: SavedView (1)    # each record wraps one arrangement
```
