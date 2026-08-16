// Headless (no-DOM, no-framework) table construction for tests.
//
// A v9 table needs reactivity bindings. `@tanstack/svelte-table` injects its
// rune-based ones automatically, which is why app code never mentions them —
// and why the shared registry in `./features` must NOT declare any: the adapter
// merges its own FIRST and spreads user features over the top, so a
// `coreReactivityFeature` in `features` would silently replace the rune
// bindings and break every grid's reactivity.
//
// Node tests have no adapter, so they opt in here to the vanilla TanStack
// Store bindings. Keeping this in its own module (imported only from `*.test.ts`)
// keeps `storeReactivityBindings` out of the app bundle.

import { constructTable, tableFeatures } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import type { RowData, TableOptions } from '@tanstack/table-core';
import { features, type PortalFeatures, type PortalTable } from './features';

const headlessFeatures = tableFeatures({
  ...features,
  coreReactivityFeature: storeReactivityBindings(),
});

/**
 * Build a table with the portal's feature set, driven by vanilla store
 * reactivity instead of Svelte runes. Behaviour (sorting, filtering,
 * pagination, visibility) is identical — only the reactivity binding differs.
 *
 * Typed as a plain `PortalTable<TData>` so tests exercise the SAME
 * `PortalColumnDef` / `PortalTable` types the pages use. The extra
 * `coreReactivityFeature` slot would otherwise make this a structurally
 * different `TFeatures`, forcing every test to duplicate the type aliases for
 * what is purely a harness detail.
 */
export function makeHeadlessTable<TData extends RowData>(
  options: Omit<TableOptions<PortalFeatures, TData>, 'features'>,
): PortalTable<TData> {
  // Descriptor copy, not a spread — same reason as `withFeatures`: a spread
  // would evaluate any reactive `get data()` once and freeze it.
  const merged = Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(options),
    features: { value: headlessFeatures, enumerable: true, configurable: true },
  });
  return constructTable(merged as unknown as TableOptions<PortalFeatures, TData>) as PortalTable<TData>;
}
