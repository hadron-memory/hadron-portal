/**
 * #1604 item 2: a compact chip truncates, and its full URN lived only in a
 * `title` tooltip, which a touch device cannot show. On a coarse pointer a
 * compact, UNLINKED chip becomes a toggle that reveals the whole URN. A linked
 * chip is left alone (a tap there navigates), and a fine pointer is unchanged.
 *
 * The pointer is read in an effect (client-only), so this is the client lane:
 * a server render never runs it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Urn from './Urn.svelte';

const URN = 'hrn:mem:hadronmemory.com:hadron-dev-team';

type Listener = (e: { matches: boolean }) => void;

/** A controllable `(pointer: coarse)` media query, with its listeners visible. */
function stubPointer(coarse: boolean, narrow = false) {
  const listeners = new Set<Listener>();
  const narrowListeners = new Set<Listener>();
  const mq = {
    matches: coarse,
    media: '(pointer: coarse)',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  const nq = {
    matches: narrow,
    media: '(max-width: 639px)',
    addEventListener: (_: string, l: Listener) => narrowListeners.add(l),
    removeEventListener: (_: string, l: Listener) => narrowListeners.delete(l),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => (q === '(pointer: coarse)' ? mq : q === '(max-width: 639px)' ? nq : { ...mq, matches: false, media: q })),
  );
  return {
    listeners,
    narrowListeners,
    setNarrow(next: boolean) {
      nq.matches = next;
      for (const l of [...narrowListeners]) l({ matches: next });
      flushSync();
    },
    set(next: boolean) {
      mq.matches = next;
      for (const l of [...listeners]) l({ matches: next });
      flushSync();
    },
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function mountUrn(props: Record<string, unknown>) {
  const m = mountComponent(Urn as never, reactiveProps({ value: URN, type: 'memory', ...props }) as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}

const toggle = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLButtonElement>('button[aria-expanded]');
const valueSpan = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLElement>('span[title]')!;

describe('Urn: tap-to-reveal on a coarse pointer (#1604)', () => {
  it('a compact unlinked chip toggles between truncated and the full URN', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    const t = toggle(m);
    expect(t).not.toBeNull();
    expect(t!.getAttribute('type')).toBe('button');
    expect(t!.getAttribute('aria-expanded')).toBe('false');
    expect(valueSpan(m).className).toContain('truncate');
    expect(valueSpan(m).textContent).toBe('hadronmemory.com:hadron-dev-team');
    // #1642 UX P2: a purpose in the name (with the value kept in it), a
    // visible cue, and a 24px minimum height.
    expect(t!.getAttribute('aria-label')).toBe(`Show full URN ${URN}`);
    expect(t!.querySelector('svg[data-reveal-cue][aria-hidden="true"]')).not.toBeNull();
    expect(t!.classList.contains('min-h-6')).toBe(true);

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('true');
    expect(valueSpan(m).className).not.toContain('truncate');
    expect(valueSpan(m).className).toContain('[overflow-wrap:anywhere]');
    expect(valueSpan(m).textContent).toBe(URN);

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('false');
    expect(valueSpan(m).className).toContain('truncate');
  });

  it('the copy buttons stay siblings outside the toggle and still copy the full URN', async () => {
    stubPointer(true);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const m = mountUrn({ compact: true });
    toggle(m)!.click();
    flushSync();
    const copy = m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy URN"]')!;
    expect(toggle(m)!.contains(copy)).toBe(false);
    copy.click();
    expect(writeText).toHaveBeenCalledWith(URN);
  });

  it('a linked compact chip does not toggle: it stays a link', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true, linked: true });
    expect(toggle(m)).toBeNull();
    expect(m.target.querySelector('a')?.getAttribute('href')).toBe(`/app/u/${URN}`);
    expect(valueSpan(m).className).toContain('truncate');
  });

  it('a wide fine pointer keeps the plain chip (no toggle)', () => {
    stubPointer(false);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).toBeNull();
    expect(m.target.querySelector('code')).not.toBeNull();
  });

  it('a non-compact chip never toggles, even on a coarse pointer', () => {
    stubPointer(true);
    const m = mountUrn({});
    expect(toggle(m)).toBeNull();
  });

  it('follows a pointer change while mounted, and collapses when the toggle goes away', () => {
    const pointer = stubPointer(false);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).toBeNull();

    pointer.set(true);
    expect(toggle(m)).not.toBeNull();
    toggle(m)!.click();
    flushSync();
    expect(valueSpan(m).className).toContain('[overflow-wrap:anywhere]');

    pointer.set(false);
    expect(toggle(m)).toBeNull();
    expect(valueSpan(m).className).toContain('truncate');
  });

  it('a chip that becomes linked or non-compact while mounted stops being a toggle', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).not.toBeNull();
    m.props.linked = true;
    flushSync();
    // Not just "no <button>": the link itself must carry no toggle semantics.
    expect(m.target.querySelector('[aria-expanded], [role="button"]')).toBeNull();
    expect(m.target.querySelector('a')).not.toBeNull();

    m.props.linked = false;
    flushSync();
    expect(toggle(m)).not.toBeNull();
    m.props.compact = false;
    flushSync();
    expect(toggle(m)).toBeNull();
  });

  it('a chip revealed, then left on a fine pointer, comes back collapsed', () => {
    const pointer = stubPointer(true);
    const m = mountUrn({ compact: true });
    toggle(m)!.click();
    flushSync();
    expect(toggle(m)!.getAttribute('aria-expanded')).toBe('true');
    pointer.set(false);
    pointer.set(true);
    expect(toggle(m)!.getAttribute('aria-expanded')).toBe('false');
    expect(valueSpan(m).className).toContain('truncate');
  });

  it('a linked or non-compact chip never listens to the pointer', () => {
    const pointer = stubPointer(true);
    mountUrn({ compact: true, linked: true });
    mountUrn({});
    expect(pointer.listeners.size).toBe(0);
  });

  it('a chip expanded, then linked, then unlinked comes back collapsed (#1642 BLIND P3)', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    toggle(m)!.click();
    flushSync();
    m.props.linked = true;
    flushSync();
    m.props.linked = false;
    flushSync();
    expect(toggle(m)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('expanded, linked, fine, unlinked, coarse: comes back collapsed (#1642 LOCAL P3)', () => {
    const pointer = stubPointer(true);
    const m = mountUrn({ compact: true });
    toggle(m)!.click();
    flushSync();
    m.props.linked = true;
    flushSync();
    pointer.set(false);
    m.props.linked = false;
    flushSync();
    pointer.set(true);
    expect(toggle(m)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a media query without addEventListener reads the pointer once and does not throw (#1642 BLIND P3)', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, media: '(pointer: coarse)' })));
    const m = mountUrn({ compact: true });
    expect(toggle(m)).not.toBeNull();
  });

  it('removes its media-query listener on unmount', () => {
    const pointer = stubPointer(true);
    const m = mountUrn({ compact: true });
    expect(pointer.listeners.size).toBe(1);
    m.unmount();
    expect(pointer.listeners.size).toBe(0);
  });

  it('renders the plain chip, without throwing, where matchMedia is absent', () => {
    vi.stubGlobal('matchMedia', undefined);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).toBeNull();
    expect(m.target.querySelector('code')).not.toBeNull();
  });
});

describe('Urn: a keyboard user can read a truncated URN (#1686)', () => {
  const tip = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLElement>('[role="tooltip"]');
  const chip = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLElement>('code')!;

  it('a narrow viewport reveals on a fine pointer too, and follows a resize', () => {
    const pointer = stubPointer(false, true);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).not.toBeNull();
    toggle(m)!.click();
    flushSync();
    expect(valueSpan(m).textContent).toContain(URN);

    pointer.setNarrow(false);
    expect(toggle(m)).toBeNull();
    expect(valueSpan(m).className).toContain('truncate');
  });

  it('a wide fine-pointer chip is focusable and shows the whole URN while focused', () => {
    stubPointer(false, false);
    const m = mountUrn({ compact: true });
    const c = chip(m);
    expect(c.getAttribute('tabindex')).toBe('0');
    expect(tip(m)).toBeNull();

    c.focus();
    flushSync();
    expect(tip(m)?.textContent).toBe(URN);
    expect(c.getAttribute('aria-describedby')).toBe(tip(m)!.id);
    // Fixed, so a cell's overflow cannot clip it and the row's height cannot change.
    expect(tip(m)!.style.position).toBe('fixed');

    c.blur();
    flushSync();
    expect(tip(m)).toBeNull();
    expect(c.hasAttribute('aria-describedby')).toBe(false);
  });

  it('Escape dismisses the readout without moving focus', () => {
    stubPointer(false, false);
    const m = mountUrn({ compact: true });
    const c = chip(m);
    c.focus();
    flushSync();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(tip(m)).toBeNull();
    expect(document.activeElement).toBe(c);
  });

  it('a linked or non-compact chip gets no extra tab stop', () => {
    stubPointer(false, false);
    expect(chip(mountUrn({ compact: false })).hasAttribute('tabindex')).toBe(false);
    expect(mountUrn({ compact: true, linked: true }).target.querySelector('a')!.hasAttribute('tabindex')).toBe(false);
  });
});

describe('Urn: touch targets for its own controls (#1686)', () => {
  it('copy buttons and the reveal toggle extend their hit area to 44px tall on a coarse pointer', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    for (const el of [toggle(m)!, ...m.target.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')]) {
      expect(el.className).toContain('relative');
      expect(el.className).toContain('pointer-coarse:after:absolute');
      expect(el.className).toContain('pointer-coarse:after:min-h-11');
      expect(el.className).toContain('pointer-coarse:after:min-w-6');
    }
  });
});
