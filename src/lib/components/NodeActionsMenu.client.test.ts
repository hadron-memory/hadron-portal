/** #1019/#1020: NodeActionsMenu's href and disabled actions, with the menu open. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import NodeActionsMenu from './NodeActionsMenu.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function open(actions: unknown[], onselect = vi.fn()) {
  const m = mountComponent(NodeActionsMenu as never, { actions, onselect, label: 'Row actions' } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  m.target.querySelector<HTMLButtonElement>('button[aria-label="Row actions"]')!.click();
  flushSync();
  return { target: m.target, onselect };
}

describe('NodeActionsMenu actions', () => {
  it('renders an href action as a real link and never calls onselect for it', () => {
    const { target, onselect } = open([{ id: 'open', label: 'Open app', href: '/app/apps/a1' }]);
    const link = target.querySelector<HTMLAnchorElement>('a[role="menuitem"]')!;
    expect(link.getAttribute('href')).toBe('/app/apps/a1');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom: don't navigate
    link.click();
    expect(onselect).not.toHaveBeenCalled();
  });

  it('keeps a disabled action focusable and explained, but inert', () => {
    const { target, onselect } = open([
      { id: 'download', label: 'Download', disabled: true, title: 'Scan has not finished' },
      { id: 'delete', label: 'Delete', danger: true },
    ]);
    const download = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === 'Download')!;
    expect(download.getAttribute('aria-disabled')).toBe('true');
    expect(download.hasAttribute('disabled')).toBe(false); // still reachable by arrow keys / AT
    expect(download.getAttribute('title')).toBe('Scan has not finished');
    download.click();
    flushSync();
    expect(onselect).not.toHaveBeenCalled();
    expect(target.querySelector('[role="menu"]')).not.toBeNull(); // the menu stays open

    [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === 'Delete')!.click();
    expect(onselect).toHaveBeenCalledWith('delete');
  });
});
