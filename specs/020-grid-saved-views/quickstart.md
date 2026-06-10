# Quickstart: Saved Views

How to add saved views to a grid-backed list, and how to verify the feature.

## Add saved views to a list (developer)

1. Make sure the list already runs on the unified grid (`createSvelteTable` from
   `src/lib/table/createSvelteTable.svelte`) and exposes its `table` instance.
2. Give the list (or its page) a stable `listKey` per the scheme in
   `data-model.md` (e.g. `memory:<memoryId>:nodes`, `usage:sessions`).
3. Render the picker next to the search / page-size controls:

   ```svelte
   <script lang="ts">
     import ViewPicker from '$lib/components/table/ViewPicker.svelte';
     // `table` is the createSvelteTable instance this list already builds
     let { listKey }: { listKey?: string } = $props();
   </script>

   {#if listKey}
     <ViewPicker {table} {listKey} />
   {/if}
   ```

4. That's it — no per-list view logic. The picker reads/applies state via the
   `table` instance and persists through the default localStorage `ViewStore`.

## Verify (maps to Success Criteria)

1. **Save + reapply (SC-001)**: arrange a list (sort, search, hide a column, set
   page size), Save as "My view", reload and navigate away/back → the list
   returns to that arrangement.
2. **Sticky active (FR-005a)**: create a second view, select it, reload → the
   selected (not the default) view is applied.
3. **Default on first open (SC-003)**: in a fresh profile (no active pointer),
   mark a view default → it applies on first open.
4. **Switch is instant (SC-002)**: switching views re-arranges immediately.
5. **Modified + Save/Reset (SC-006)**: tweak the sort → "modified" badge shows;
   Save clears it and persists; Reset reverts.
6. **Discard on switch**: while modified, select another view → tweaks dropped,
   selected view applied, no dialog.
7. **Resilient apply (SC-005)**: a stored view referencing a removed column still
   loads; remaining valid settings apply, no crash.
8. **All lists (SC-004)**: repeat on memory-browse nodes, agents, node table,
   and both usage tables.
9. **Store-only persistence (SC-007)**: confirm only `ViewStore` touches
   storage; the picker/lists never read localStorage directly.

## Run the tests

```bash
pnpm vitest run src/lib/table
```

Covers `savedView` (incl. `globalFilter` + resilient `applyView`), the
localStorage `ViewStore`, and the `viewController` resolution / modified-state /
save / reset / delete-fallback transitions — all headless (no DOM).
