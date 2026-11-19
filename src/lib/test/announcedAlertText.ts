/**
 * The text of the first live region that is actually announcing something.
 *
 * Per
 * `hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted`
 * a `role="alert"` region stays mounted while idle — present but empty,
 * announcing nothing — so "does an alert region exist?" is always yes on a
 * page with such a region and pins nothing a user experiences. What a user
 * experiences is the region's *content*. This walks the page's alert regions
 * in order and returns the first non-empty one's trimmed text, or null when
 * nothing is being announced.
 *
 * A `toBeNull()` assertion on this helper pins "nothing was announced",
 * which is what the old first-`querySelector('[role="alert"]')` query was
 * approximating back when every region on the page happened to be
 * conditionally mounted and an absent region meant a silent one.
 */
export function announcedAlertText(scope: Element | Document): string | null {
  for (const region of scope.querySelectorAll<HTMLElement>('[role="alert"]')) {
    const text = region.textContent?.trim() ?? '';
    if (text) return text;
  }
  return null;
}
