/**
 * The three slices of the top-level Files section (portal#696 part 1).
 *
 * Shared between the loader (which maps a slice to `assets()` arguments) and the
 * page (which renders the tab strip), so the two cannot disagree about which
 * slices exist or what they're called.
 */

export const ASSET_TABS = ['mine', 'available', 'org'] as const;
export type AssetTab = (typeof ASSET_TABS)[number];

export const DEFAULT_ASSET_TAB: AssetTab = 'mine';

/** Narrow an untrusted `?tab=` value; anything unrecognised falls back. */
export function parseAssetTab(value: string | null | undefined): AssetTab {
  return ASSET_TABS.includes(value as AssetTab) ? (value as AssetTab) : DEFAULT_ASSET_TAB;
}

/**
 * The `assets()` arguments for a slice.
 *
 * The default scope of `assets()` is already the caller's accessible set, so each
 * tab is a FILTER over one query rather than a query of its own:
 *
 * - `mine`      → `filter: { mine: true }` (their own uploads, across memories)
 * - `available` → nothing (the whole accessible set)
 * - `org`       → `orgId` (that org's memories)
 *
 * **`org` returns null when there is no active org, and the caller MUST NOT fall
 * back to the default scope.** Sending `orgId: undefined` would quietly return
 * every asset the caller can reach and label it "this organization's" — the same
 * relabelling trap `hrn:node:hadronmemory.com:hadron-server:conventions:multi-ref-scope-args` calls out for an empty
 * `memoryRefs` list. The page shows an explanatory empty state instead.
 */
export function assetQueryArgs(
  tab: AssetTab,
  activeOrgId: string | null | undefined,
): { filter?: { mine?: boolean }; orgId?: string } | null {
  switch (tab) {
    case 'mine':
      return { filter: { mine: true } };
    case 'available':
      return {};
    case 'org':
      return activeOrgId ? { orgId: activeOrgId } : null;
  }
}
