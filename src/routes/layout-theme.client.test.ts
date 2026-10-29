/** #419: the root layout applies the stored Light / Dark / System choice and follows the OS for System. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Layout from './+layout.svelte';

type Listener = (e: { matches: boolean }) => void;
let osDark = true;
let listeners: Set<Listener>;

beforeEach(() => {
  osDark = true;
  listeners = new Set();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.matchMedia = ((q: string) => ({
    media: q,
    get matches() { return osDark; },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as never;
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountLayout() {
  const children = createRawSnippet(() => ({ render: () => '<p>page</p>' }));
  const m = mountComponent(Layout as never, { data: { user: null }, children } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  await Promise.resolve();
  flushSync();
  return m;
}
const isDark = () => document.documentElement.classList.contains('dark');
async function choose(m: Mounted<Record<string, unknown>>, label: string) {
  m.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  flushSync();
  await Promise.resolve();
  [...m.target.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.textContent?.includes(label))!.click();
  flushSync();
}

describe('root layout theme (#419)', () => {
  it('stays dark when nothing was ever chosen, as before', async () => {
    osDark = false; // the OS preference must not matter to a reader who never chose System
    await mountLayout();
    expect(isDark()).toBe(true);
  });

  it('honours a stored light choice and a stored dark choice', async () => {
    localStorage.setItem('theme', 'light');
    const m = await mountLayout();
    expect(isDark()).toBe(false);
    m.unmount();
    mounted.pop();
    localStorage.setItem('theme', 'dark');
    await mountLayout();
    expect(isDark()).toBe(true);
  });

  it('follows the OS under System, live', async () => {
    localStorage.setItem('theme', 'system');
    osDark = false;
    await mountLayout();
    expect(isDark()).toBe(false);
    osDark = true;
    listeners.forEach((l) => l({ matches: true }));
    flushSync();
    expect(isDark()).toBe(true);
  });

  it('applies and stores a pick from the menu, and System then follows the OS', async () => {
    const m = await mountLayout();
    await choose(m, 'Light');
    expect(isDark()).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    // The OS changes while the reader is on Light: a real one fires the event,
    // and the layout keeps listening whatever the choice, so System is current.
    osDark = false;
    listeners.forEach((l) => l({ matches: false }));
    await choose(m, 'System');
    expect(localStorage.getItem('theme')).toBe('system');
    expect(isDark()).toBe(false);
    osDark = true;
    listeners.forEach((l) => l({ matches: true }));
    flushSync();
    expect(isDark()).toBe(true);
  });

  it('stops following the OS once unmounted', async () => {
    localStorage.setItem('theme', 'system');
    const m = await mountLayout();
    expect(listeners.size).toBe(1);
    m.unmount();
    mounted.pop();
    expect(listeners.size).toBe(0);
  });
});
