import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import TabRow from './TabRow.svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';

const items = ['one', 'two', 'three', 'four'].map(id => ({ id, label: id, href: `/view/${id}` }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
function setup(mode: 'tabs' | 'links', active = 'four', space = 280) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this.hasAttribute('data-tab-row-measure') ? 100 : this.hasAttribute('data-tab-row-root') ? space : 60;
    return { width, height: 40, top: 0, left: 0, bottom: 40, right: width, x: 0, y: 0, toJSON() {} };
  });
  const activate = vi.fn();
  const view = mountComponent(TabRow, { mode, label: 'Views', items: mode === 'tabs' ? items.map(({id,label}) => ({id,label})) : items, active, onselect: activate });
  cleanups.push(view.unmount);
  return { ...view, activate };
}
function key(el: Element, value: string) { el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); flushSync(); }

describe('bounded tab row', () => {
  it('swaps the selected overflow tab into the visible row and links its panel', async () => {
    const { target } = setup('tabs'); await tick(4);
    const selected = target.querySelector('[role=tab][aria-selected=true]')!;
    expect(selected.textContent).toBe('four');
    expect(selected.getAttribute('aria-controls')).toBe('panel-four');
    expect(selected.getAttribute('tabindex')).toBe('0');
    expect(target.querySelectorAll('[role=tab]').length).toBe(2);
    expect(target.querySelector('[role=tablist]')?.getAttribute('aria-label')).toBe('Views');
  });
  it.each(['tabs', 'links'] as const)('%s menu opens, moves, closes and returns focus', async mode => {
    const { target } = setup(mode); await tick(4);
    const more = target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    more.focus(); key(more, ' '); await tick(4);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menuItems = target.querySelectorAll<HTMLElement>('[role=menuitem]');
    expect(document.activeElement).toBe(menuItems[0]);
    key(menuItems[0], 'ArrowDown'); expect(document.activeElement).toBe(menuItems[1]);
    key(menuItems[1], 'Escape'); await tick(4);
    expect(target.querySelector('[role=menu]')).toBeNull(); expect(document.activeElement).toBe(more);
  });
  it('links remain native anchors without tab semantics, including overflow', async () => {
    const { target } = setup('links'); await tick(4);
    expect(target.querySelector('nav[aria-label=Views]')).not.toBeNull();
    expect(target.querySelector('[role=tablist], [role=tab], [aria-selected]')).toBeNull();
    expect(target.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/view/four');
    target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!.click(); await tick(4);
    expect([...target.querySelectorAll('[role=menuitem]')].every(el => el.tagName === 'A' && el.getAttribute('href'))).toBe(true);
  });
  it('tabs arrow through the visible choices and More, wrapping without skipping', async () => {
    const { target } = setup('tabs', 'one'); await tick(4);
    const tabs = target.querySelectorAll<HTMLElement>('[role=tab]');
    tabs[0].focus(); key(tabs[0], 'ArrowRight'); expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'ArrowRight'); expect(document.activeElement).toBe(target.querySelector('[aria-haspopup=menu]'));
    key(document.activeElement!, 'ArrowRight'); expect(document.activeElement).toBe(tabs[0]);
  });
  it('omits More at the exact fit and shows it one pixel below the threshold', async () => {
    const full = setup('tabs', 'one', 400); await tick(4);
    expect(full.target.querySelector('[aria-haspopup=menu]')).toBeNull();
    expect(full.target.querySelectorAll('[role=tab]')).toHaveLength(4);
    full.unmount();
    const narrow = setup('tabs', 'one', 399); await tick(4);
    expect(narrow.target.querySelector('[aria-haspopup=menu]')).not.toBeNull();
  });
  it('an overflow choice invokes the existing callback, and outside click closes without selecting', async () => {
    const { target, activate } = setup('tabs'); await tick(4);
    const more = target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    more.click(); await tick(4);
    target.querySelector<HTMLButtonElement>('[role=menuitem]')!.click(); await tick(4);
    expect(activate).toHaveBeenCalledExactlyOnceWith('two');
    expect(target.querySelector('[role=menu]')).toBeNull();
    more.click(); await tick(4);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await tick(4);
    expect(target.querySelector('[role=menu]')).toBeNull();
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('IME Escape leaves the menu open; body Escape closes only this open layer', async () => {
    const { target } = setup('tabs'); await tick(4);
    const more = target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    more.click(); await tick(4);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    await tick(4); expect(target.querySelector('[role=menu]')).not.toBeNull();
    document.body.focus(); key(document.body, 'Escape'); await tick(4);
    expect(target.querySelector('[role=menu]')).toBeNull(); expect(document.activeElement).toBe(more);
  });
  it('unmount during the menu-open microtask does not focus an old row or leak a key listener', async () => {
    const { target, unmount } = setup('tabs'); await tick(4);
    target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!.click();
    unmount(); await tick(4);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });

  it.each(['tabs', 'links'] as const)('%s keeps focus on More when an item activation is refused', async mode => {
    // The tab callback deliberately leaves active unchanged. The link control
    // cancels its default action: neither should strand focus on BODY after
    // the focused menu item is removed. This is not a Kit router simulation.
    const { target, activate } = setup(mode); await tick(4);
    const more = target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    more.click(); await tick(4);
    const choice = target.querySelector<HTMLElement>('[role=menuitem]')!;
    expect(document.activeElement).toBe(choice);
    if (mode === 'links') choice.addEventListener('click', event => event.preventDefault(), { once: true });
    choice.click(); await tick(4);
    expect(target.querySelector('[role=menu]')).toBeNull();
    if (mode === 'tabs') expect(activate).toHaveBeenCalledExactlyOnceWith('two');
    expect(document.activeElement).toBe(more);
  });

});
