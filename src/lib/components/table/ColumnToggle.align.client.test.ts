import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { COLUMN_MENU_WIDTH_PX } from './columnMenuAlign';
import DialogTableHarness from '$lib/test/DialogTableHarness.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

type Rect = { left: number; right: number };
const toDomRect = (rect: Rect) => ({ ...rect, top: 0, bottom: 20, width: rect.right - rect.left, height: 20, x: rect.left, y: 0, toJSON() {} }) as DOMRect;

async function openMenu(rect: Rect) {
  const m = mountComponent(DialogTableHarness, {});
  mounted.push(m);
  const summary = m.target.querySelector('details > summary') as HTMLElement;
  summary.getBoundingClientRect = () => toDomRect(rect);
  (summary.parentElement as HTMLDetailsElement).open = true;
  summary.parentElement!.dispatchEvent(new Event('toggle'));
  flushSync(); await tick();
  return m.target.querySelector('details > div') as HTMLElement | null;
}

describe('ColumnToggle menu alignment (#2149)', () => {
  it('hangs from the left edge when right alignment would leave the viewport', async () => {
    const menu = await openMenu({ left: 79, right: 159 });
    expect(menu).not.toBeNull();
    expect(menu!.classList.contains('left-0')).toBe(true);
    expect(menu!.classList.contains('right-0')).toBe(false);
  });
  it('keeps right-0 when the menu fits toward the left', async () => {
    const menu = await openMenu({ left: 1100, right: 1180 });
    expect(menu!.classList.contains('right-0')).toBe(true);
    expect(menu!.classList.contains('left-0')).toBe(false);
  });
  it('applies the one shared width as an inline style', async () => {
    const menu = await openMenu({ left: 1100, right: 1180 });
    expect(menu!.style.width).toBe(`${COLUMN_MENU_WIDTH_PX}px`);
  });
  it('re-aligns while open when the viewport is resized, keeping the menu open and choices intact', async () => {
    const m = mountComponent(DialogTableHarness, {});
    mounted.push(m);
    const details = m.target.querySelector('details') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    let rect: Rect = { left: 1100, right: 1180 };
    summary.getBoundingClientRect = () => toDomRect(rect);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    flushSync(); await tick();
    const menu = () => details.querySelector(':scope > div') as HTMLElement;
    expect(menu().classList.contains('right-0')).toBe(true);
    const before = Array.from(details.querySelectorAll('input[type=checkbox]')).map((i) => (i as HTMLInputElement).checked);

    rect = { left: 79, right: 159 };
    window.dispatchEvent(new Event('resize'));
    flushSync(); await tick();
    expect(details.open).toBe(true);
    expect(menu().classList.contains('left-0')).toBe(true);
    expect(menu().classList.contains('right-0')).toBe(false);
    const after = Array.from(details.querySelectorAll('input[type=checkbox]')).map((i) => (i as HTMLInputElement).checked);
    expect(after).toEqual(before);
  });
  it('stops listening once closed', async () => {
    const m = mountComponent(DialogTableHarness, {});
    mounted.push(m);
    const details = m.target.querySelector('details') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    let calls = 0;
    summary.getBoundingClientRect = () => { calls++; return toDomRect({ left: 1100, right: 1180 }); };
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    flushSync(); await tick();
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    flushSync(); await tick();
    const seen = calls;
    window.dispatchEvent(new Event('resize'));
    flushSync(); await tick();
    expect(calls).toBe(seen);
  });
});
