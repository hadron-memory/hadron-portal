import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import TabRow from './TabRow.svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';

const items = ['one', 'two', 'three', 'four'].map(id => ({ id, label: id, href: `/view/${id}` }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
function setup(mode: 'tabs' | 'links', active = 'four') {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this.hasAttribute('data-tab-row-measure') ? 100 : this.hasAttribute('data-tab-row-root') ? 280 : 60;
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
    const { target } = setup('tabs'); await tick();
    const selected = target.querySelector('[role=tab][aria-selected=true]')!;
    expect(selected.textContent).toBe('four');
    expect(selected.getAttribute('aria-controls')).toBe('panel-four');
    expect(selected.getAttribute('tabindex')).toBe('0');
    expect(target.querySelectorAll('[role=tab]').length).toBe(2);
    expect(target.querySelector('[role=tablist]')?.getAttribute('aria-label')).toBe('Views');
  });
  it.each(['tabs', 'links'] as const)('%s menu opens, moves, closes and returns focus', async mode => {
    const { target } = setup(mode); await tick();
    const more = target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    more.focus(); key(more, ' '); await tick();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menuItems = target.querySelectorAll<HTMLElement>('[role=menuitem]');
    expect(document.activeElement).toBe(menuItems[0]);
    key(menuItems[0], 'ArrowDown'); expect(document.activeElement).toBe(menuItems[1]);
    key(menuItems[1], 'Escape'); await tick();
    expect(target.querySelector('[role=menu]')).toBeNull(); expect(document.activeElement).toBe(more);
  });
  it('links remain native anchors without tab semantics, including overflow', async () => {
    const { target } = setup('links'); await tick();
    expect(target.querySelector('[role=tablist], [role=tab], [aria-selected]')).toBeNull();
    expect(target.querySelector('[aria-current=page]')?.getAttribute('href')).toBe('/view/four');
    target.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!.click(); await tick();
    expect([...target.querySelectorAll('[role=menuitem]')].every(el => el.tagName === 'A' && el.getAttribute('href'))).toBe(true);
  });
  it('tabs arrow through the visible choices and More, wrapping without skipping', async () => {
    const { target } = setup('tabs', 'one'); await tick();
    const tabs = target.querySelectorAll<HTMLElement>('[role=tab]');
    tabs[0].focus(); key(tabs[0], 'ArrowRight'); expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'ArrowRight'); expect(document.activeElement).toBe(target.querySelector('[aria-haspopup=menu]'));
    key(document.activeElement!, 'ArrowRight'); expect(document.activeElement).toBe(tabs[0]);
  });
});
