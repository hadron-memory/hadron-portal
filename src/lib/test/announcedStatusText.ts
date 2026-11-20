/**
 * The text of the first `role="status"` region with non-empty text content.
 *
 * This is a DOM query, not proof of what a screen reader announced: it also sees static copy
 * present at mount and visually hidden text. Scope it to the region under test when several
 * status regions coexist.
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

/**
 * The `role="status"` regions that exist right now and are empty. Take this
 * BEFORE the action under test: a region that speaks afterwards must be one of
 * these, i.e. it already existed, empty, and only its content changed. A
 * conditionally mounted region is not in this list, which is the defect.
 *
 *     const idle = idleStatusRegions(root);
 *     …act…
 *     expect(idle).toContain(announcedStatusRegion(root));
 */
export function idleStatusRegions(scope: Element | Document): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => !r.textContent?.trim());
}
