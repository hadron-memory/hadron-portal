import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { idleStatusRegions } from './firstPopulatedStatusText';

/** How the note's text is recognised: a substring, a regular expression, or a predicate on a region's text. */
export type RegionText = string | RegExp | ((regionText: string) => boolean);

export interface LiveRegionLifecycle {
  /** The element to search under. */
  root: Element;
  /** The note's text. A RegExp is matched statelessly (its `g`/`y` flags are ignored). */
  text: RegionText;
  /** Flip the page's own inputs so the note appears (a failed read, a reload, a navigation). */
  appear: () => unknown;
  /** Flip them back so the note goes. Omit when the condition cannot be undone in the test. */
  disappear?: () => unknown;
  /** Let any async continuation land after each flip. */
  settle?: () => Promise<unknown>;
  /** When several nested regions hold the text, pin the innermost (default) or the outermost. */
  whichRegion?: 'innermost' | 'outermost';
  /** Also require that the region is not inside a `hidden` ancestor while it speaks and after it clears. */
  mustBeVisible?: boolean;
}

/** A matcher that cannot carry `lastIndex` between regions: `g` and `y` are stripped from a RegExp. */
function statelessMatcher(text: RegionText): (regionText: string) => boolean {
  if (typeof text === 'string') return (t) => t.includes(text);
  if (typeof text === 'function') return text;
  const fresh = new RegExp(text.source, text.flags.replace(/[gy]/g, ''));
  return (t) => fresh.test(t);
}

const describeText = (text: RegionText) => (typeof text === 'function' ? 'the predicate' : String(text));

/**
 * The before / during / after pin for a status note converted to `LiveRegion` (portal#2344, #2376).
 *
 * A screen reader announces a CHANGE inside a live region that already exists, so what is pinned is the
 * lifecycle, not the presence of some `role="status"` carrying the text:
 *
 *  - before: the note is not on screen, and the region that will speak already exists, empty;
 *  - during: after `appear()` that same region holds the text and is `aria-live="polite"`;
 *  - after: after `disappear()` the SAME element is still connected, still a status region, and empty.
 *
 * On the old conditional shape `<p role="status">` the element holding the text did not exist before,
 * so the "existed, empty, before" assertion fails. Returns the region for further pins.
 */
export async function expectLiveRegionLifecycle(opts: LiveRegionLifecycle): Promise<HTMLElement> {
  const { root, text, appear, disappear, settle = async () => {}, whichRegion = 'innermost', mustBeVisible = false } = opts;
  const matches = statelessMatcher(text);
  const label = describeText(text);
  const statusRegions = () => [...root.querySelectorAll<HTMLElement>('[role="status"]')];
  const holding = () => statusRegions().filter((r) => matches(r.textContent ?? ''));

  expect(holding(), `${label} is not on screen before it appears`).toHaveLength(0);
  const idle = idleStatusRegions(root);
  expect(idle.length, 'a status region exists, empty, before the note appears').toBeGreaterThan(0);

  await appear();
  flushSync();
  await settle();
  const holders = holding();
  expect(holders.length, `${label} is inside a role="status" region once it appears`).toBeGreaterThan(0);
  const region = whichRegion === 'innermost' ? holders[holders.length - 1] : holders[0];
  expect(region.getAttribute('aria-live'), 'it is a LiveRegion').toBe('polite');
  expect(idle, `the region holding ${label} existed, empty, before it appeared`).toContain(region);
  if (mustBeVisible) expect(region.closest('[hidden]'), 'the region is not inside a hidden ancestor while it speaks').toBeNull();

  if (disappear) {
    await disappear();
    flushSync();
    await settle();
    expect(region.isConnected, 'the region is still in the document after the note clears').toBe(true);
    expect(statusRegions(), 'and is still a status region of the page').toContain(region);
    expect((region.textContent ?? '').trim(), 'and is empty again').toBe('');
    expect(idleStatusRegions(root), 'and it is the same element, idle').toContain(region);
    if (mustBeVisible) expect(region.closest('[hidden]'), 'and is still not inside a hidden ancestor').toBeNull();
  }
  return region;
}
