import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { idleStatusRegions } from './firstPopulatedStatusText';

const statusRegions = (root: Element) => [...root.querySelectorAll<HTMLElement>('[role="status"]')];

/**
 * The before/during/after pin for a note that comes and goes (portal#2344, portal#2376).
 *
 * A screen reader announces a CHANGE inside a live region that already exists. So `on` makes the
 * note appear and `off` makes it go, and the pin is that the region holding it
 *   - existed, EMPTY, before `on` (it is in `idleStatusRegions` taken first),
 *   - holds `text` during, and
 *   - is the SAME element, empty again, after `off`.
 * A conditionally mounted `role="status"` fails the first assertion: it is created by `on`.
 *
 * Returns the region so a caller can pin more (its first child's classes, say).
 */
export async function expectRegionLifecycle(
  root: Element,
  text: string | RegExp,
  on: () => unknown,
  off: () => unknown,
  settle: () => Promise<unknown> = async () => {},
): Promise<HTMLElement> {
  const idle = idleStatusRegions(root);
  await on();
  flushSync();
  await settle();
  const holds = (r: HTMLElement) => (typeof text === 'string' ? (r.textContent ?? '').includes(text) : text.test(r.textContent ?? ''));
  const speaking = statusRegions(root).find(holds);
  expect(speaking, `a role="status" region holds ${String(text)}`).toBeDefined();
  expect(idle, `the region holding ${String(text)} existed, empty, before it spoke`).toContain(speaking);
  await off();
  flushSync();
  await settle();
  expect(speaking!.isConnected, 'the region is still in the document after the note clears').toBe(true);
  expect(statusRegions(root), 'and is still the live region of the page').toContain(speaking);
  expect((speaking!.textContent ?? '').trim(), 'and is empty again').toBe('');
  return speaking!;
}
