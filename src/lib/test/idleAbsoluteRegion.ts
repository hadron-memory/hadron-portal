import { expect } from 'vitest';
import { tick } from '$lib/test/mountComponent';

/**
 * portal#2454: a LiveRegion that sits in a flex row and is taken out of flow while idle must say so
 * with `idle:absolute`, never `empty:absolute`. A whitespace text node (markup between an `{#if}` and
 * its region) is JS-idle (`data-idle`) but breaks CSS `:empty`, so `empty:absolute` never applies and the
 * idle region stays a flex item (portal#2394). jsdom computes no Tailwind, so the pin is the class the
 * region carries plus the `data-idle` it keeps with that whitespace node present.
 */
export async function expectIdleAbsoluteRegion(root: Element): Promise<void> {
  const regions = [...root.querySelectorAll<HTMLElement>('[role="status"]')].filter(
    (r) => /(^|\s)(idle|empty):absolute(\s|$)/.test(r.className),
  );
  expect(regions.length, 'a status region taken out of flow while idle').toBeGreaterThan(0);
  for (const region of regions) {
    region.append(document.createTextNode('\n  '));
    await tick(2);
    expect(region.hasAttribute('data-idle'), 'idle with a whitespace text node').toBe(true);
    expect(region.matches(':empty'), 'a whitespace text node breaks :empty').toBe(false);
    expect(region.classList.contains('idle:absolute'), 'carries idle:absolute').toBe(true);
    expect(region.classList.contains('empty:absolute'), 'does not carry empty:absolute').toBe(false);
  }
}
