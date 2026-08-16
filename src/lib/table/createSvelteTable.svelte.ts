// Portal factory over the OFFICIAL @tanstack/svelte-table (v9) adapter.
//
// History: under v8 there was no usable Svelte 5 adapter — the published
// @tanstack/svelte-table targeted Svelte 3/4 and imported the removed
// `svelte/internal` — so this file hand-rolled one (hold state in `$state`,
// feed it back through `setOptions`, `mergeObjects` for reactive reads,
// `$effect.pre` to flush before paint). v9 ships that design natively, backed
// by rune-aware TanStack Store atoms, so the hand-rolled adapter and its
// `merge.svelte.ts` helper are gone.
//
// What remains is a ~10-line factory whose only job is pre-binding the portal's
// shared feature registry, so no call site has to repeat it.

import { createTable } from '@tanstack/svelte-table';
import type { RowData, TableOptions } from '@tanstack/table-core';
import { withFeatures, type PortalFeatures, type PortalTable } from './features';

/**
 * Create a portal grid. Identical to the official `createTable`, minus the
 * `features` option — that is supplied from `./features`.
 *
 * Reactive data is passed as a getter (`get data() { return rows; }`), and
 * state slices are read back with `table.atoms.<slice>.get()`. `withFeatures`
 * (NOT an object spread) is what keeps those getters live — see its docstring.
 */
export function createSvelteTable<TData extends RowData>(
  options: Omit<TableOptions<PortalFeatures, TData>, 'features'>,
): PortalTable<TData> {
  return createTable(withFeatures(options));
}
