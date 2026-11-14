import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import DialogTableHarness from '$lib/test/DialogTableHarness.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function openMenu(rect: { left: number; right: number }) {
  const m = mountComponent(DialogTableHarness, {});
  mounted.push(m);
  const summary = m.target.querySelector('details > summary') as HTMLElement;
  summary.getBoundingClientRect = () => ({ ...rect, top: 0, bottom: 20, width: rect.right - rect.left, height: 20, x: rect.left, y: 0, toJSON() {} }) as DOMRect;
  (summary.parentElement as HTMLDetailsElement).open = true;
  summary.parentElement!.dispatchEvent(new Event('toggle'));
  flushSync(); await tick();
  return m.target.querySelector('details > div') as HTMLElement | null;
}

describe('ColumnToggle menu alignment (#2149)', () => {
  it('hangs from the left edge when right alignment would leave the viewport', async () => {
    window.innerWidth = 390;
    const menu = await openMenu({ left: 79, right: 159 });
    expect(menu).not.toBeNull();
    expect(menu!.classList.contains('left-0')).toBe(true);
    expect(menu!.classList.contains('right-0')).toBe(false);
  });
  it('keeps right-0 at desktop width', async () => {
    window.innerWidth = 1280;
    const menu = await openMenu({ left: 1100, right: 1180 });
    expect(menu!.classList.contains('right-0')).toBe(true);
  });
});
