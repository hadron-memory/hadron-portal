/** #419: the Light / Dark / System menu, driven in a real DOM. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import ThemeMenu from './ThemeMenu.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function setup(preference = 'dark') {
  const onselect = vi.fn();
  const m = mountComponent(ThemeMenu as never, { preference, onselect } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  const trigger = m.target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  return { m, trigger, onselect };
}
const items = (t: HTMLElement) => [...t.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
async function openMenu(trigger: HTMLButtonElement) {
  trigger.click();
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
}
const key = (k: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
};

describe('ThemeMenu', () => {
  it('is a closed, named button until opened', () => {
    const { m, trigger } = setup();
    expect(trigger.getAttribute('aria-label')).toBe('Theme');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(m.target.querySelector('[role="menu"]')).toBeNull();
  });

  it('offers Light, Dark and System, marks the current one, and focuses it on open', async () => {
    const { m, trigger } = setup('system');
    await openMenu(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const list = items(m.target);
    expect(list.map((b) => b.textContent?.trim())).toEqual(['Light', 'Dark', 'System']);
    expect(list.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(document.activeElement).toBe(list[2]);
  });

  it('reports the pick, closes, and returns focus to the button', async () => {
    const { m, trigger, onselect } = setup('dark');
    await openMenu(trigger);
    items(m.target)[0]!.click();
    flushSync();
    expect(onselect).toHaveBeenCalledExactlyOnceWith('light');
    expect(m.target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves with the arrow keys, wrapping, and closes on Escape with focus back on the button', async () => {
    const { m, trigger } = setup('light');
    await openMenu(trigger);
    key('ArrowDown');
    expect(document.activeElement).toBe(items(m.target)[1]);
    key('End');
    expect(document.activeElement).toBe(items(m.target)[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items(m.target)[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items(m.target)[2]);
    key('Escape');
    expect(m.target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside, not on one inside', async () => {
    const { m, trigger } = setup();
    await openMenu(trigger);
    m.target.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(m.target.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(m.target.querySelector('[role="menu"]')).toBeNull();
  });

  it('stops listening once unmounted (a key after teardown does nothing)', async () => {
    const { m, trigger, onselect } = setup();
    await openMenu(trigger);
    m.unmount();
    mounted.pop();
    expect(() => key('Escape')).not.toThrow();
    expect(onselect).not.toHaveBeenCalled();
  });
});
