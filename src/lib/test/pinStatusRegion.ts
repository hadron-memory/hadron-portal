import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { idleStatusRegions } from './firstPopulatedStatusText';

/**
 * The before / during / after pin for a status note converted to `LiveRegion` (portal#2344, #2376).
 *
 * A screen reader announces a CHANGE inside a live region that already exists, so what is pinned is the
 * lifecycle, not the presence of some `role="status"` carrying the text:
 *
 *  - before: the region that will speak exists in the DOM and is empty (it is in the idle snapshot);
 *  - during: after `raise()` that same region holds the text;
 *  - after: after `clear()` the SAME element is still connected and empty again.
 *
 * On the old conditional shape `<p role="status">` the element that holds the text did not exist before,
 * so the "was idle before" assertion fails. `raise`/`clear` flip the page's own inputs (props), the way a
 * reload, a failed read or a navigation does; `settle` lets any async continuation land.
 */
export async function pinRegion(opts: {
  root: Element;
  text: string;
  raise: () => void | Promise<void>;
  clear?: () => void | Promise<void>;
  settle?: () => Promise<void>;
  /** Which match to pin when the text shows in more than one region (default: the last, i.e. the innermost). */
  nth?: number;
}): Promise<HTMLElement> {
  const { root, text, raise, clear, settle = async () => {} } = opts;
  const holding = () => [...root.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => r.textContent?.includes(text));
  expect(holding(), `“${text}” is not on screen before it is raised`).toHaveLength(0);
  const idle = idleStatusRegions(root);

  await raise();
  flushSync();
  await settle();
  const matches = holding();
  expect(matches.length, `“${text}” is inside a role="status" region once raised`).toBeGreaterThan(0);
  const region = matches[opts.nth ?? matches.length - 1];
  expect(region.getAttribute('aria-live'), 'it is a LiveRegion').toBe('polite');
  expect(idle, `the region holding “${text}” existed, empty, before it was raised`).toContain(region);

  if (clear) {
    await clear();
    flushSync();
    await settle();
    expect(region.isConnected, 'the region is still in the document after the note clears').toBe(true);
    expect(region.textContent?.trim(), 'and it is empty again').toBe('');
    expect(idleStatusRegions(root), 'and it is the same element, idle').toContain(region);
  }
  return region;
}
