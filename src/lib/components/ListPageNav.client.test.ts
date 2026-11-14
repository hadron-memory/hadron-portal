/** #1954 — an unavailable pager control announces itself as a disabled LINK
 * (role="link" + aria-disabled), stays outside the sequential tab order, and
 * carries no href and no handler, so nothing can navigate. Enabled controls
 * are native anchors with the page's exact URLs; the disabled state must not
 * alter them. Every direction (First/Previous/Next) is pinned both ways.
 *
 * "Nothing can navigate" is observed, not inferred from markup: after pointer
 * and keyboard activation the window URL is unchanged and the navigation
 * recorder stayed silent — a handler a future change smuggles onto the span
 * (e.g. a hash rewrite) turns this red instead of surviving a dead-span
 * assertion (#1973 review: a click-handler mutant passed every structural
 * check).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
  // reactiveProps: the disabled-prop transition test mutates m.props on the
  // LIVE instance — a plain object would not propagate into the component.
  const m = mountComponent(ListPageNav as never, reactiveProps({ page: PAGE, label: 'List pages', disabled } as never) as never) as Mounted<NavProps>;
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
    const before = window.location.href;
    resetNavigationCalls();
    for (const { name } of DIRECTIONS) {
      const el = control(m.target, name);
      el.click();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      // Still an inert span — activation did nothing, and no anchor appeared.
      expect(el.tagName).toBe('SPAN');
      expect(m.target.querySelector('a')).toBeNull();
    }
    // Observed, not inferred: no activation moved the URL or reached the
    // navigation recorder. A handler smuggled onto the span (a hash rewrite,
    // a goto) fails here even though the span markup still looks inert.
    expect(window.location.href).toBe(before);
    expect(navigationCalls).toEqual([]);
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
    // ONE mounted instance, toggled through the prop — the transition is the
    // behavior under test (#1973 review: a second, independently mounted
    // component proved nothing about recovery). Disabled → enabled must
    // restore the exact anchors with their original URLs and rel; disabled
    // again must return to inert spans with nothing navigable.
    const m = mountNav(true);
    expect(m.target.querySelector('a')).toBeNull();
    m.props.disabled = false;
    flushSync();
    for (const { name, href, rel } of DIRECTIONS) {
      const el = control(m.target, name);
      expect(el.tagName).toBe('A');
      expect(el.getAttribute('href')).toBe(href);
      expect(el.getAttribute('rel')).toBe(rel);
    }
    m.props.disabled = true;
    flushSync();
    expect(m.target.querySelector('a')).toBeNull();
    for (const { name } of DIRECTIONS) {
      const el = control(m.target, name);
      expect(el.tagName).toBe('SPAN');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.hasAttribute('href')).toBe(false);
      expect(el.hasAttribute('tabindex')).toBe(false);
    }
  });
});

// #2170 F8: a list that fits on one page has nothing to navigate to, so it
// gets no navigation landmark, only the count.
describe('ListPageNav with nothing to link', () => {
  const ONE_PAGE: ListPageNavigation = { offset: 0, count: 3, total: 3, firstHref: null, previousHref: null, nextHref: null };
  function mountPage(page: ListPageNavigation) {
    const m = mountComponent(ListPageNav as never, { page, label: 'List pages' } as never) as Mounted<NavProps>;
    mounted.push(m as never);
    return m;
  }

  it('renders the count without a navigation landmark', () => {
    const m = mountPage(ONE_PAGE);
    expect(m.target.querySelector('nav')).toBeNull();
    expect(m.target.querySelector('[role="navigation"]')).toBeNull();
    expect(m.target.textContent).toContain('1–3 of 3');
  });

  it('renders the landmark when even one direction links (control)', () => {
    const m = mountPage({ ...ONE_PAGE, total: 30, nextHref: '/app/list?o=20' });
    expect(m.target.querySelector('nav[aria-label="List pages"] a[rel="next"]')).not.toBeNull();
  });

  it('a lone First link at offset ≤ 20 does not count as something to link', () => {
    // ListPageNav only renders First past offset 20, so firstHref alone at
    // offset 0 links nothing.
    const m = mountPage({ ...ONE_PAGE, firstHref: '/app/list?o=0' });
    expect(m.target.querySelector('nav')).toBeNull();
  });
});
