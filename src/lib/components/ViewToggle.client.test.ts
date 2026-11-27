import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import ViewToggle from './ViewToggle.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const options = [{ id: 'table', label: 'Table' }, { id: 'tree', label: 'Tree' }];
const mountToggle = (props: Record<string, unknown> = {}) => {
  const m = mountComponent(ViewToggle as never, { label: 'Nodes view', options, value: 'table', onselect: () => {}, ...props } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
};
const buttons = (t: HTMLElement) => [...t.querySelectorAll<HTMLButtonElement>('[role="group"] button')];

describe('ViewToggle', () => {
  it('is a named group whose shown view is the pressed button, in option order', () => {
    const t = mountToggle();
    expect(t.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Nodes view');
    expect(buttons(t).map((b) => [b.textContent?.trim(), b.getAttribute('aria-pressed')])).toEqual([['Table', 'true'], ['Tree', 'false']]);
  });

  it('reports the chosen id, and takes its position from the caller', async () => {
    const onselect = vi.fn();
    const t = mountToggle({ onselect, class: 'ml-auto' });
    buttons(t)[1].click();
    await tick(2);
    expect(onselect).toHaveBeenCalledWith('tree');
    expect(t.querySelector('[role="group"]')!.className).toContain('ml-auto');
  });
});
