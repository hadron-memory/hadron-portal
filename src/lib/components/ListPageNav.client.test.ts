/** #1954 — an unavailable pager control announces itself as a disabled LINK
 * (role="link" + aria-disabled), stays outside the sequential tab order, and
 * carries no href and no handler, so nothing can navigate. Enabled controls
 * are native anchors with the page's exact URLs; the disabled state must not
 * alter them. Every direction (First/Previous/Next) is pinned both ways.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import ListPageNav from './ListPageNav.svelte';
import type { ListPageNavigation } from '$lib/list-page';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const PAGE: ListPageNavigation = {
  offset: 40,
  count: 20,
  total: 100,
  firstHref: '/app/list?o=0',
  previousHref: '/app/list?o=20',
  nextHref: '/app/list?o=60',
};

type NavProps = { page: ListPageNavigation; label: string; disabled?: boolean };

function mountNav(disabled?: boolean) {
  const m = mountComponent(ListPageNav as never, { page: PAGE, label: 'List pages', disabled } as never) as Mounted<NavProps>;
  mounted.push(m as never);
  return m;
}

const DIRECTIONS = [
  { name: 'First', href: PAGE.firstHref!, rel: null },
  { name: 'Previous', href: PAGE.previousHref, rel: 'prev' },
  { name: 'Next', href: PAGE.nextHref, rel: 'next' },
] as const;

function control(root: HTMLElement, name: string) {
  return [...root.querySelectorAll<HTMLElement>('nav > *')].find((el) => el.textContent?.trim() === name)!;
}

describe('ListPageNav unavailable controls', () => {
  it('renders each disabled direction as an inert link: role=link, aria-disabled, no href, no tab stop', () => {
    const m = mountNav(true);
    expect(m.target.querySelector('nav > span')?.textContent).toContain('41–60 of 100');
    for (const { name } of DIRECTIONS) {
      const el = control(m.target, name);
      expect(el.tagName).toBe('SPAN');
      expect(el.getAttribute('role')).toBe('link');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      // Not actionable and not in the tab order: no href, no tabindex, no handler.
      expect(el.hasAttribute('href')).toBe(false);
      expect(el.hasAttribute('tabindex')).toBe(false);
      expect((el as HTMLElement).tabIndex).toBe(-1);
      expect(el.className).toContain('cursor-not-allowed');
    }
    // No native anchor renders while disabled — there is nothing to navigate.
    expect(m.target.querySelector('a')).toBeNull();
  });

  it('cannot be navigated by pointer or keyboard while disabled', () => {
    const m = mountNav(true);
    for (const { name } of DIRECTIONS) {
      const el = control(m.target, name);
      el.click();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      // Still an inert span — activation did nothing, and no anchor appeared.
      expect(el.tagName).toBe('SPAN');
      expect(m.target.querySelector('a')).toBeNull();
    }
  });

  it('renders each enabled direction as a native anchor with the page URL and rel', () => {
    const m = mountNav(false);
    for (const { name, href, rel } of DIRECTIONS) {
      const el = control(m.target, name);
      expect(el.tagName).toBe('A');
      expect(el.getAttribute('href')).toBe(href);
      expect(el.getAttribute('rel')).toBe(rel);
      expect(el.hasAttribute('aria-disabled')).toBe(false);
    }
  });

  it('returns to valid navigation with unchanged URLs after a disabled stretch', () => {
    const wasDisabled = mountNav(true);
    expect(wasDisabled.target.querySelector('a')).toBeNull();
    const enabled = mountNav(false);
    for (const { name, href } of DIRECTIONS) {
      expect(control(enabled.target, name).getAttribute('href')).toBe(href);
    }
  });
});
