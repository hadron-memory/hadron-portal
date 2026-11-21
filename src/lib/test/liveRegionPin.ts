/**
 * The lifecycle pin for a live region (portal#2344, portal#2379). A screen reader announces a CHANGE
 * inside a region that already exists, so a conversion is pinned by what it does over time: the region
 * EXISTS and is EMPTY before, holds the text during, and is the SAME element after. A test that only
 * looks for the text afterwards also passes on a region inserted already populated, which is the defect.
 *
 *   const before = emptyRegions(root);           // before: they exist, empty
 *   ...act...
 *   const region = regionHolding(root, 'Saved'); // during: exactly one region holds the text
 *   expect(before).toContain(region);            // it was one of the already-mounted, empty ones
 */
export const liveRegions = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')];

/** The regions that exist right now and say nothing. */
export const emptyRegions = (root: ParentNode): HTMLElement[] =>
  liveRegions(root).filter((el) => el.textContent?.trim() === '');

/** The ONE live region whose text contains `text`; throws if none or several do. */
export function regionHolding(root: ParentNode, text: string): HTMLElement {
  const holding = liveRegions(root).filter((el) => el.textContent?.includes(text));
  if (holding.length !== 1) throw new Error(`expected exactly one live region holding "${text}", found ${holding.length}`);
  return holding[0];
}
