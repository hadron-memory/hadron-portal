/**
 * #1604 item 2: a compact chip truncates, and its full URN lived only in a
 * `title` tooltip, which a touch device cannot show. On a coarse pointer an
 * unlinked chip becomes a toggle; #1686 adds the same reveal below sm and
 * gives linked chips a sibling toggle so their anchors still navigate.
 * Wide fine-pointer chips stay plain and copy keeps the full canonical values.
 *
 * The media queries are read in an effect (client-only), so this is the client
 * lane: a server render never runs it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Urn from './Urn.svelte';

const URN = 'hrn:mem:hadronmemory.com:hadron-dev-team';

type Listener = (e: { matches: boolean }) => void;

/** Controllable pointer/viewport media queries, with their listeners visible. */
function stubPointer(coarse: boolean, narrow = false) {
  const listeners = new Set<Listener>();
  const narrowListeners = new Set<Listener>();
  const mq = {
    matches: coarse,
    media: '(pointer: coarse)',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  const narrowMq = {
    matches: narrow,
    media: '(max-width: 639px)',
    addEventListener: (_: string, l: Listener) => narrowListeners.add(l),
    removeEventListener: (_: string, l: Listener) => narrowListeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn((q: string) => {
    if (q === mq.media) return mq;
    if (q === narrowMq.media) return narrowMq;
    return { ...mq, matches: false, media: q };
  }));
  return {
    listeners,
    narrowListeners,
    set(next: boolean) {
      mq.matches = next;
      for (const l of [...listeners]) l({ matches: next });
      flushSync();
    },
    setNarrow(next: boolean) {
      narrowMq.matches = next;
      for (const l of [...narrowListeners]) l({ matches: next });
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

/** portal#2506: the collapsed value is a one-line clamp with wrap-anywhere — single-line
 *  ellipsis whose min-content collapses, unlike a nowrap `truncate` whose min-content is
 *  the full text width (which escapes a caller wrapper with no max-w-full/min-w-0).
 *  portal#2538 (blind F12): tokens match exactly — the old substring includes()
 *  read `line-clamp-10` as `line-clamp-1` (a collapsed chip clamping to ten lines),
 *  and the expanded check's negative let any clamp that was not literally -1 through. */
const hasToken = (cls: string, token: string) => cls.split(/\s+/).includes(token);
const hasClamp = (cls: string) => cls.split(/\s+/).some(t => t.startsWith('line-clamp-') && t !== 'line-clamp-none');
const collapsedClasses = (cls: string) => hasToken(cls, 'line-clamp-1') && hasToken(cls, '[overflow-wrap:anywhere]') && !hasToken(cls, 'whitespace-normal');
/** The revealed value wraps freely: no clamp of any count, break opportunities everywhere. */
const expandedClasses = (cls: string) => hasToken(cls, 'whitespace-normal') && hasToken(cls, '[overflow-wrap:anywhere]') && !hasClamp(cls);

/** portal#2538 (local delta P2, blind P2-1): the chip's box and its clip are two
 *  elements. Vertical padding on the CLAMPING span re-opens the band under line 1
 *  where a wrapped second line shows (a clamp clips at its padding box), and the
 *  wrapper must say it is a block rather than lean on flex blockification. */
describe('Urn: the compact chip box and clip stay two elements (portal#2538 QA F1)', () => {
  // A variant prefix does not hide it: `dark:py-1` and `sm:pt-2` still pad the clamp.
  const PAD_Y = /^(?:[^:\s]+:)*-?(?:p|py|pt|pb)-/;
  it('the clamping span carries no vertical padding; its wrapper carries the chip box', () => {
    stubPointer(false);
    const m = mountUrn({ value: URN, compact: true });
    const span = valueSpan(m);
    const wrapper = span.parentElement!;
    const spanTokens = span.className.split(/\s+/);
    expect(spanTokens.filter(t => PAD_Y.test(t)), span.className).toEqual([]);
    expect(['dark:py-1', 'sm:pt-2', 'py-0.5', 'pb-1'].every(t => PAD_Y.test(t)) && !['px-1.5', 'min-w-0'].some(t => PAD_Y.test(t))).toBe(true);
    const wrapperTokens = wrapper.className.split(/\s+/);
    expect(wrapperTokens, wrapper.className).toContain('py-0.5');
    expect(wrapperTokens, wrapper.className).toContain('block');
  });
});

describe('Urn: the class matchers are token-exact (portal#2538 blind F12)', () => {
  it('a multi-line clamp is not the collapsed single line', () => {
    expect(collapsedClasses('min-w-0 line-clamp-10 [overflow-wrap:anywhere]')).toBe(false);
  });

  it('a value with any clamp left on it is not expanded', () => {
    expect(expandedClasses('whitespace-normal [overflow-wrap:anywhere] line-clamp-2')).toBe(false);
  });

  it('the real tokens still match', () => {
    expect(collapsedClasses('min-w-0 line-clamp-1 [overflow-wrap:anywhere]')).toBe(true);
    expect(expandedClasses('whitespace-normal [overflow-wrap:anywhere]')).toBe(true);
  });
});

describe('Urn: a compact chip never drops a part of the URN', () => {
  // A URN is shown whole: ellipsis at the end is fine, a missing `hrn:<type>:` is not (Holger, #2644).
  it('shows hrn:<type>: at the start, with no reveal needed', () => {
    stubPointer(false);
    const m = mountUrn({ compact: true });
    expect(valueSpan(m).textContent).toBe(URN);
    expect(valueSpan(m).textContent?.startsWith('hrn:')).toBe(true);
  });
});

describe('Urn: compact reveal and touch targets (#1604/#1686)', () => {
  it('a compact unlinked chip toggles between the ellipsed full URN and the wrapped full URN', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    const t = toggle(m);
    expect(t).not.toBeNull();
    expect(t!.getAttribute('type')).toBe('button');
    expect(t!.getAttribute('aria-expanded')).toBe('false');
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);
    expect(valueSpan(m).textContent).toBe(URN); // always the whole URN, hrn:<type>: included; only the END may be ellipsed
    // #1642 UX P2: a purpose in the name (with the value kept in it) and a
    // visible cue. #1686 keeps fine rows dense and uses 44px coarse targets.
    expect(t!.getAttribute('aria-label')).toBe(`Show full URN ${URN}`);
    expect(t!.querySelector('svg[data-reveal-cue][aria-hidden="true"]')).not.toBeNull();
    expect(t!.classList.contains('min-h-6')).toBe(false);
    expect(t!.classList.contains('pointer-coarse:min-h-11')).toBe(true);
    expect(t!.classList.contains('pointer-coarse:min-w-11')).toBe(true);

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('true');
    expect(expandedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);
    expect(valueSpan(m).textContent).toBe(URN);

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('false');
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);
  });

  it('the copy buttons stay siblings outside the toggle and still copy the full URN', async () => {
    stubPointer(true);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const m = mountUrn({ compact: true });
    toggle(m)!.click();
    flushSync();
    const copy = m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy URN"]')!;
    const copyUrl = m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy URL"]')!;
    expect(toggle(m)!.contains(copy)).toBe(false);
    for (const button of [copy, copyUrl]) {
      expect(button.classList.contains('pointer-coarse:min-h-11')).toBe(true);
      expect(button.classList.contains('pointer-coarse:min-w-11')).toBe(true);
      expect(button.classList.contains('pointer-coarse:items-center')).toBe(true);
      expect(button.classList.contains('pointer-coarse:justify-center')).toBe(true);
    }
    copy.click();
    expect(writeText).toHaveBeenCalledWith(URN);
    copyUrl.click();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/u/${URN}`);
  });

  it('a narrow fine pointer gets the reveal and collapses when the viewport grows', () => {
    const media = stubPointer(false, true);
    const m = mountUrn({ compact: true });
    const t = toggle(m);
    expect(t).not.toBeNull();
    expect(m.target.querySelector('code')).toBeNull();

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('true');
    expect(valueSpan(m).textContent).toBe(URN);

    media.setNarrow(false);
    expect(toggle(m)).toBeNull();
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);

    media.setNarrow(true);
    expect(toggle(m)!.getAttribute('aria-expanded')).toBe('false');
    expect(valueSpan(m).textContent).toBe(URN); // always the whole URN, hrn:<type>: included; only the END may be ellipsed
  });

  it('removes both media-query listeners on unmount', () => {
    const media = stubPointer(false, true);
    const m = mountUrn({ compact: true });
    expect(media.listeners.size).toBe(1);
    expect(media.narrowListeners.size).toBe(1);
    m.unmount();
    expect(media.listeners.size).toBe(0);
    expect(media.narrowListeners.size).toBe(0);
  });

  it('a linked compact chip stays a link and gets a separate reveal button', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true, linked: true });
    const anchor = m.target.querySelector('a')!;
    const t = toggle(m);
    expect(anchor.getAttribute('href')).toBe(`/app/u/${URN}`);
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);
    expect(t).not.toBeNull();
    expect(anchor.contains(t)).toBe(false);
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);

    t!.click();
    flushSync();
    expect(t!.getAttribute('aria-expanded')).toBe('true');
    expect(valueSpan(m).textContent).toBe(URN);
    expect(anchor.getAttribute('href')).toBe(`/app/u/${URN}`);
  });

  it('a wide fine pointer keeps the plain chip (no toggle, no extra tab stop)', () => {
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
    expect(expandedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);

    pointer.set(false);
    expect(toggle(m)).toBeNull();
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);
  });

  it('a chip that becomes linked moves the toggle outside the anchor; non-compact removes it', () => {
    stubPointer(true);
    const m = mountUrn({ compact: true });
    expect(toggle(m)).not.toBeNull();
    m.props.linked = true;
    flushSync();
    const anchor = m.target.querySelector('a')!;
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);
    expect(anchor.hasAttribute('role')).toBe(false);
    expect(toggle(m)).not.toBeNull();
    expect(anchor.contains(toggle(m))).toBe(false);

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
    expect(collapsedClasses(valueSpan(m).className), valueSpan(m).className).toBe(true);
  });

  it('a non-compact chip never listens; a linked compact chip follows both reveal queries', () => {
    const pointer = stubPointer(true);
    mountUrn({ compact: true, linked: true });
    expect(pointer.listeners.size).toBe(1);
    expect(pointer.narrowListeners.size).toBe(1);
    mountUrn({});
    expect(pointer.listeners.size).toBe(1);
    expect(pointer.narrowListeners.size).toBe(1);
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

  // portal#2330: a second copy must restart the confirmation, not inherit the first one's timer.
  it('a repeated copy keeps its confirmation for a full two seconds from the latest copy', async () => {
    stubPointer(false);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const m = mountUrn({ compact: false });
    const copy = m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy URN"]')!;
    const confirmed = () => copy.querySelector('polyline') !== null;
    vi.useFakeTimers();
    try {
      copy.click();
      await vi.advanceTimersByTimeAsync(1500);
      expect(confirmed()).toBe(true);
      copy.click();
      await vi.advanceTimersByTimeAsync(1000); // 2500ms after the first copy, 1000ms after the second
      expect(confirmed()).toBe(true);
      await vi.advanceTimersByTimeAsync(1100);
      expect(confirmed()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not confirm a copy that failed', async () => {
    stubPointer(false);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const m = mountUrn({ compact: false });
    const copy = m.target.querySelector<HTMLButtonElement>('button[aria-label="Copy URN"]')!;
    copy.click();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(copy.querySelector('polyline')).toBeNull();
  });
});
