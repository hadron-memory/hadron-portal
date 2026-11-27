import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import FloatingAddButton from './FloatingAddButton.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const mountButton = (props: Record<string, unknown> = {}) => {
  const m = mountComponent(FloatingAddButton as never, { label: 'Add node', onclick: () => {}, ...props } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
};

describe('FloatingAddButton', () => {
  it('is named by its label and fires onclick', async () => {
    const onclick = vi.fn();
    const t = mountButton({ onclick });
    const b = t.querySelector('button')!;
    expect(b.textContent?.trim()).toBe('Add node');
    b.click();
    await tick(2);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('says nothing about expansion unless it opens something in place', () => {
    expect(mountButton().querySelector('button')!.hasAttribute('aria-expanded')).toBe(false);
    expect(mountButton({ expanded: true }).querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('disabled: inert, and the reason is given to assistive technology', () => {
    const t = mountButton({ disabled: true, disabledReason: 'Nothing to cast.' });
    const b = t.querySelector('button')!;
    expect(b.disabled).toBe(true);
    expect(t.querySelector(`#${b.getAttribute('aria-describedby')}`)!.textContent).toBe('Nothing to cast.');
  });

  it('gives each disabled button its own reason id', () => {
    const a = mountButton({ disabled: true, disabledReason: 'One.' }).querySelector('button')!;
    const b = mountButton({ disabled: true, disabledReason: 'Two.' }).querySelector('button')!;
    expect(a.getAttribute('aria-describedby')).not.toBe(b.getAttribute('aria-describedby'));
  });
});
