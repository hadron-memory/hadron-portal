/**
 * The text of the first `role="status"` region that is actually announcing something.
 *
 * Sibling of `announcedAlertText`. Per
 * `hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted`
 * a status region stays mounted while idle (`LiveRegion`), present but empty, so a
 * first-match `querySelector('[role="status"]')` finds the empty region and
 * `toBeNull()` on it is always false. What a reader hears is the content: this
 * returns the first non-empty region's trimmed text, or `null` when nothing is
 * being announced. See
 * `hrn:node:hadronmemory.com:hadron-portal:review:persistent-live-region-retargets-generic-alert-queries`.
 */
export function announcedStatusText(scope: Element | Document): string | null {
  for (const region of scope.querySelectorAll<HTMLElement>('[role="status"]')) {
    const text = region.textContent?.trim() ?? '';
    if (text) return text;
  }
  return null;
}

/**
 * The first `role="status"` region that is announcing something, as an element.
 * Its `firstElementChild` is the visible box a `LiveRegion` call site renders
 * (the one carrying the classes, `tabindex` and focus), for a test that needs
 * the element rather than its text.
 */
export function announcedStatusRegion(scope: Element | Document): HTMLElement | null {
  for (const region of scope.querySelectorAll<HTMLElement>('[role="status"]')) {
    if (region.textContent?.trim()) return region;
  }
  return null;
}
