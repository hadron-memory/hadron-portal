/**
 * Whether MemoryBrowser may hand TreeView its reorder handler, which renumbers
 * a parent's children seq 1…N from the siblings it can see.
 *
 * That is only correct over the COMPLETE sibling set. A server-paged browser
 * (portal#1881) shows one page of an App's nodes, so it refuses whenever its
 * pool may be missing siblings: a partial page, search/filter results, active
 * facets, or hidden record/system nodes. Unpaged browsers (a memory's own page,
 * an Agent's) keep exactly the behaviour they had before #1881 — guarding them
 * too was not asked for and silently removed reorder (#1929 LOCAL F1).
 */
export interface TreeReorderState {
  serverPaged: boolean;
  truncated: boolean;
  serverResults: boolean;
  activeFilters: boolean;
  hiddenUnshown: boolean;
}

export function treeReorderAllowed(s: TreeReorderState): boolean {
  if (!s.serverPaged) return true;
  return !s.truncated && !s.serverResults && !s.activeFilters && !s.hiddenUnshown;
}
