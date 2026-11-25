import { tick } from './mountComponent';

/**
 * Wait until the frame that follows a mount has been painted, then let Svelte settle.
 *
 * A `LiveRegion` with `deferFirst` fills itself after the first paint of the frame it was inserted in
 * (`requestAnimationFrame`, then a zero timeout). The component's own rAF and timeout are queued before
 * these, so awaiting this runs after the fill. portal#2388.
 */
export async function firstPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  await tick(2);
}
