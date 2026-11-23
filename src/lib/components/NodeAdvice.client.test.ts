/** #1371 — saved-change advice reaches a reader who saved from far down a long form. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/NodeAdviceHarness.svelte';
import { INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';

// jsdom has no layout, so no scrollIntoView to spy on.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});
function mountAdvice(initial: string[]) {
  const m = mountComponent(Harness as never, { initial } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  const set = (a: string[]) => { (m.instance as { setAdvice: (a: string[]) => void }).setAdvice(a); flushSync(); };
  return { m, set, region: () => m.target.querySelector('[role="status"]') };
}

describe('NodeAdvice live region (#1371, Uma P3-1)', () => {
  it('keeps one empty status region mounted, so inserted advice is announced', () => {
    const { m, set, region } = mountAdvice([]);
    const before = region();
    expect(before).not.toBeNull();
    expect(before!.textContent!.trim()).toBe('');
    expect(m.target.querySelector('[data-testid="node-save-advice"]')).toBeNull();

    set([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(region()).toBe(before);
    expect(before!.textContent).toContain(INCLUDE_PIN_UNKEPT_TEXT);

    set([]);
    expect(region()).toBe(before);
    expect(before!.textContent!.trim()).toBe('');
  });
});

describe('NodeAdvice on first load (#1371, Uma)', () => {
  it('advice present at first load shows in the region without scrolling', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { region } = mountAdvice([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(region()!.textContent).toContain('Advice from a saved change');
    expect(region()!.textContent).toContain(INCLUDE_PIN_UNKEPT_TEXT);
    expect(region()!.querySelector('[data-testid="node-save-advice"]')).not.toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  });
  it('renders advice as plain text, never authored HTML', () => {
    const { region } = mountAdvice(['<img src=x onerror=alert(1)>']);
    expect(region()!.querySelector('img')).toBeNull();
    expect(region()!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('NodeAdvice proximity (#1371, Uma P3-2)', () => {
  it('brings advice that arrives on a mounted page into view, without moving focus', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { m, set } = mountAdvice([]);
    const focused = document.createElement('button');
    document.body.appendChild(focused);
    focused.focus();
    expect(scroll).not.toHaveBeenCalled();

    set([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(m.target.querySelector('[data-testid="node-save-advice"]'));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(focused);
    focused.remove();
  });

  it('does not scroll when advice clears', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { set } = mountAdvice([]);
    set([INCLUDE_PIN_UNKEPT_TEXT]);
    scroll.mockClear();
    set([]);
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('NodeAdvice re-delivery (#1447, Uma/Greta from #1441)', () => {
  it('scrolls again for a second advice-bearing save, once per delivery', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { m, set } = mountAdvice([]);

    set([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(scroll).toHaveBeenCalledTimes(1);

    scroll.mockClear();
    // A second enhanced save re-delivers the SAME advice as a new array (each
    // layout load yields a new one); identity, not content, drives the scroll.
    set([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    // #2453: the re-delivery scrolls the advice box itself, not anything else.
    expect(scroll.mock.contexts[0]).toBe(m.target.querySelector('[data-testid="node-save-advice"]'));
  });

  it('does not scroll when the very same array is set again (#2453)', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { set } = mountAdvice([]);
    const delivered = [INCLUDE_PIN_UNKEPT_TEXT];

    set(delivered);
    expect(scroll).toHaveBeenCalledTimes(1);

    scroll.mockClear();
    // Same reference, same content: nothing was delivered, so nothing scrolls.
    set(delivered);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('scrolls again for advice delivered after it was cleared, to the new box (#2453)', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { m, set } = mountAdvice([]);
    const box = () => m.target.querySelector('[data-testid="node-save-advice"]');

    set([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(scroll).toHaveBeenCalledTimes(1);
    set([]);
    expect(box()).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);

    // Distinct from a first load: the original empty array is still the first-load value here.
    set(['another advice line']);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll.mock.contexts[1]).toBe(box());
    expect(box()).not.toBeNull();
  });

  it('scrolls for advice delivered after a first-load advice was cleared (#2453)', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { m, set } = mountAdvice([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(scroll).not.toHaveBeenCalled();

    set([]);
    expect(scroll).not.toHaveBeenCalled();

    set(['later advice line']);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(m.target.querySelector('[data-testid="node-save-advice"]'));
  });

  it('an empty delivery never scrolls, whether advice was showing or not (#2453)', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { set } = mountAdvice([]);

    set([]);
    expect(scroll).not.toHaveBeenCalled();

    set([INCLUDE_PIN_UNKEPT_TEXT]);
    scroll.mockClear();
    set([]);
    set([]);
    expect(scroll).not.toHaveBeenCalled();
  });
});
