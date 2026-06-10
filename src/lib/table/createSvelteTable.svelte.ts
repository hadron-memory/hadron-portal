// Thin Svelte 5 (runes) adapter over @tanstack/table-core.
//
// The published @tanstack/svelte-table adapter targets Svelte 3/4 and is broken
// on Svelte 5 (it imports the removed `svelte/internal`); a runes-native
// official adapter only exists in the v9 alpha. This ~40-line file is the
// supported interim path the docs recommend: hold table state in `$state`, feed
// it back through `setOptions`, and let `mergeObjects` make reads reactive.
//
// This is the ENTIRE framework-integration surface. Everything else
// (sorting/filtering/pagination/visibility/order) is table-core and is
// identical to its React/Vue/Solid usage.

import {
  createTable as createTableCore,
  type RowData,
  type TableOptions,
  type TableOptionsResolved,
  type TableState,
  type Table,
  type Updater,
} from '@tanstack/table-core';
import { mergeObjects } from './merge.svelte';

export function createSvelteTable<TData extends RowData>(options: TableOptions<TData>): Table<TData> {
  const resolvedOptions: TableOptionsResolved<TData> = mergeObjects(
    {
      state: {},
      onStateChange() {},
      renderFallbackValue: null,
      mergeOptions: (defaultOptions: TableOptions<TData>, opts: Partial<TableOptions<TData>>) =>
        mergeObjects(defaultOptions, opts),
    },
    options,
  );

  const table = createTableCore(resolvedOptions);
  let state = $state<Partial<TableState>>(table.initialState);

  function updateOptions() {
    table.setOptions((prev) =>
      mergeObjects(prev, options, {
        state: mergeObjects(() => state, () => options.state ?? {}),
        // Uncontrolled-by-default: own the state here, but still forward to any
        // caller-supplied onStateChange (e.g. to persist a saved view).
        onStateChange: (updater: Updater<TableState>) => {
          state = updater instanceof Function ? updater(state as TableState) : updater;
          options.onStateChange?.(updater);
        },
      }),
    );
  }

  updateOptions();
  // `$effect.pre` (NOT deprecated — it's the documented "run before DOM update"
  // rune) so options flush before the template reads the row model, avoiding a
  // stale first paint when reactive options change.
  $effect.pre(() => {
    updateOptions();
  });

  return table;
}
