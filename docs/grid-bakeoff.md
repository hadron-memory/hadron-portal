# Data-grid bake-off: TanStack table-core vs AG Grid Community

Spike for the "unify all lists on one grid + user-savable views" initiative
(follow-up to #275). Both contenders rebuilt the **NodeList** as read-only
spikes with the saved-view-relevant features (sort, filter, column show/hide +
order, pagination) so they can be compared head-to-head.

Spike code (branch `spike/grid-bakeoff`, not for merge as-is):
- TanStack: `src/lib/table/{merge.svelte.ts, createSvelteTable.svelte.ts, savedView.ts}`, `src/lib/components/spike/NodeListTanstack.svelte`
- AG Grid: `src/lib/components/spike/NodeListAgGrid.svelte`
- Routes: `/lab/grid-bakeoff/tanstack`, `/lab/grid-bakeoff/aggrid` (run `pnpm dev`)
- Tests: `src/lib/table/table-logic.test.ts`

## Measured results

| Dimension | TanStack table-core | AG Grid Community |
|---|---|---|
| **Client bundle (gzip)** | **16.6 KB** (raw 59 KB) | **308 KB** (raw 1.13 MB) |
| | table-core + adapter + route | `AllCommunityModule` + route |
| **License / cost** | MIT, all features free | Community MIT (lean); grouping/pivot/agg/set-filters/master-detail = **Enterprise $999+/dev seat** |
| **Svelte 5 fit** | Runes-native via a ~40-line adapter we own | Vanilla `createGrid` (imperative); no Svelte component story (only-wrapper is dormant); SSR must be off |
| **Saved views** | View = 5 plain-JSON state slices from `getState()`; rehydrate via `initialState`. Pure data. | `api.getState()` serializes too, but it's imperative (needs the grid instance) and the shape is AG-specific/larger |
| **Testability** | Logic testable headlessly — 5 tests, 5 ms, no DOM | Needs a real browser/grid instance |
| **Cell rendering** | Plain Svelte markup (links, badges, `Urn`, etc.) | Cell renderers must return DOM/HTML strings; Svelte components need the dormant wrapper |
| **Virtualization** | Not built-in — add `@tanstack/svelte-virtual` when a list is large | Row + column virtualization on by default |
| **Maintenance** | table-core active (v9 beta); adapter is ours (small) | Mature & active, but the Svelte path is vanilla/dormant-wrapper |

Bundle measured from the production build's per-route client chunks
(`pnpm build`), gzipped. AG Grid's 308 KB bundles the entire community feature
set via `AllCommunityModule`; registering only the modules used
(ClientSideRowModel + Pagination) would shrink it, but it stays an
order of magnitude above TanStack.

## What the code looks like

**TanStack** — the entire framework-integration surface is two small files
(`merge.svelte.ts` + `createSvelteTable.svelte.ts`). Everything else is
table-core, identical to its React/Vue/Solid usage. Saved view:

```ts
const view = extractView(table.getState());   // {sorting, columnFilters, columnVisibility, columnOrder, pagination}
persist(JSON.stringify(view));                // store
createSvelteTable({ ..., initialState: viewToInitialState(view) }); // rehydrate
```

Reactivity flows because `mergeObjects` reads the `$state` lazily inside
table-core's getters, so a template calling `table.getRowModel()` re-runs when
state changes — no stores, no `Subscribe`/`Render` slot-prop boilerplate (the
svelte-headless-table idiom we're replacing).

**AG Grid** — imperative lifecycle in every list unless wrapped:

```ts
onMount(() => { api = createGrid(div, gridOptions); });
$effect(() => api?.setGridOption('rowData', nodes));  // push data
onDestroy(() => api?.destroy());
```

This is an escape hatch out of Svelte's rendering model. To make it tolerable
across many lists you'd build and maintain your own Svelte wrapper component —
i.e. you end up owning an adapter either way, but a heavier, less idiomatic one.

## Recommendation

**Adopt TanStack table-core + the custom Svelte 5 runes adapter.** It wins
decisively on bundle size (≈19×), testability, runes-nativeness, license, and —
most importantly for this initiative — **saved views are just data**, which is
exactly what we need to persist to the DB and rehydrate.

AG Grid's genuine advantages (free built-in virtualization, batteries-included
column menus/filters) don't justify, for a data-heavy app that wants saved
views: a 308 KB baseline on every list, a non-idiomatic imperative integration
with no maintained Svelte story, and a paid ceiling on exactly the advanced
features ("data-heavy") we'd grow into.

### The one real follow-up
TanStack doesn't give row virtualization for free. Most portal lists are
hundreds of rows already loaded client-side, where pagination (per #275)
suffices. When a list needs to render thousands of rows, add
`@tanstack/svelte-virtual` to that list — additive, not a rewrite.

### Suggested next steps
1. Promote the spike adapter (`src/lib/table/*`) to real, documented infra.
2. Migrate the 5 `svelte-headless-table` sites (NodeList is the canary — the
   #275 features port directly).
3. Build saved-views on top: persist `SavedView` JSON per user/list.
