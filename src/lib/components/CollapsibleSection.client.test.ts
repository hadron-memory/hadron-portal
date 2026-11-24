import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import CollapsibleSection from './CollapsibleSection.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

let bodyMounts = 0;
const body = createRawSnippet(() => ({
  render: () => '<p data-body>Body</p>',
  setup: () => { bodyMounts++; },
}));

const mountSection = (props: Record<string, unknown> = {}) => {
  bodyMounts = 0;
  const m = mountComponent(CollapsibleSection, { id: 'keys', title: 'App Keys', children: body, ...props });
  mounted.push(m);
  return m;
};
const toggle = () => document.querySelector<HTMLButtonElement>('#section-keys-toggle')!;
const region = () => document.querySelector<HTMLElement>('#section-keys-body')!;

describe('CollapsibleSection', () => {
  it('starts folded: the toggle says so, the region is hidden and the body never mounted', () => {
    mountSection();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(region().hidden).toBe(true);
    expect(document.querySelector('[data-body]')).toBeNull();
    expect(bodyMounts).toBe(0);
  });

  it('names the section by its heading, with the toggle inside it', () => {
    mountSection();
    const heading = document.querySelector('h2')!;
    expect(heading.textContent?.trim()).toBe('App Keys');
    expect(heading.contains(toggle())).toBe(true);
    expect(toggle().getAttribute('aria-controls')).toBe('section-keys-body');
    // The toggle carries the name and the state; a landmark per section would add one entry each to the page's landmark list.
    expect(region().hasAttribute('role')).toBe(false);
    expect(region().hasAttribute('aria-labelledby')).toBe(false);
  });

  it('a danger section reads red, folded or open; the default does not (portal#2612 P3)', () => {
    mountSection({ tone: 'danger' });
    expect(toggle().className).toContain('text-red-600');
    expect(toggle().className).not.toContain('text-zinc-900');
    mounted.pop()!.unmount();
    mountSection();
    expect(toggle().className).not.toContain('text-red-600');
    expect(toggle().className).toContain('text-zinc-900');
  });

  it('unfolds on a press, mounts the body once, and reports each opening', async () => {
    const onopen = vi.fn();
    mountSection({ onopen });
    toggle().click(); await tick(2);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(region().hidden).toBe(false);
    expect(document.querySelector('[data-body]')).not.toBeNull();
    expect(onopen).toHaveBeenCalledTimes(1);
  });

  it('keeps the body mounted while folded again, so a draft survives a collapse', async () => {
    const onopen = vi.fn();
    mountSection({ onopen });
    toggle().click(); await tick(2);
    toggle().click(); await tick(2);
    expect(region().hidden).toBe(true);
    expect(document.querySelector('[data-body]')).not.toBeNull();
    expect(bodyMounts).toBe(1);
    toggle().click(); await tick(2);
    expect(bodyMounts).toBe(1);
    expect(onopen).toHaveBeenCalledTimes(2);
  });

  it('opens when the page sets open (a link naming the section) and mounts the body', async () => {
    const props = reactiveProps({ id: 'keys', title: 'App Keys', children: body, open: false });
    const m = mountComponent(CollapsibleSection, props as never);
    mounted.push(m as never);
    props.open = true; flushSync(); await tick(2);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-body]')).not.toBeNull();
  });
});
