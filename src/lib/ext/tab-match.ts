/**
 * Whether a tab is the current one for a pathname (C2, #2568). Shared by the
 * org and account layouts. `exact` (the default) matches only its own href;
 * `prefix` also matches below it, on a '/' boundary so `/a/fx` does not claim
 * `/a/fx-x`.
 */
export function tabIsActive(pathname: string, tab: { href: string; match?: 'exact' | 'prefix' }): boolean {
  if (tab.match === 'prefix') {
    const base = tab.href.length > 1 ? tab.href.replace(/\/+$/, '') : tab.href;
    return pathname === base || pathname.startsWith(base + '/');
  }
  return pathname === tab.href;
}
