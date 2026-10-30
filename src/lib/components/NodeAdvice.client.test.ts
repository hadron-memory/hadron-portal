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

describe('NodeAdvice fills after mount (#1371, Uma)', () => {
  it('advice present at first load fills the region after mount, without scrolling', () => {
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
