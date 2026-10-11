/** #1002 — the Approve control: a checkmark, a filled primary look, one centre line. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import ApproveRevisionButton from './ApproveRevisionButton.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
function mountButton(props: Record<string, unknown>) {
  const m = mountComponent(ApproveRevisionButton as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target.querySelector<HTMLButtonElement>('[data-testid="approve-revision"]')!;
}

describe('ApproveRevisionButton (#1002)', () => {
  it('carries a decorative checkmark and the revision label', () => {
    const b = mountButton({ revision: 7 });
    expect(b.textContent).toContain('Approve revision 7');
    const icon = b.querySelector('svg[data-testid="approve-check"]')!;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('is vertically centred (inline-flex + items-center) and filled, not an outline link', () => {
    const b = mountButton({ revision: 7 });
    expect(b.className).toMatch(/\binline-flex\b/);
    expect(b.className).toMatch(/\bitems-center\b/);
    expect(b.className).toMatch(/\bbg-emerald-600\b/);
    expect(b.className).not.toMatch(/\bborder-zinc-300\b/);
  });

  it('is disabled while submitting and enabled otherwise', () => {
    expect(mountButton({ revision: 7, submitting: true }).disabled).toBe(true);
    expect(mountButton({ revision: 7 }).disabled).toBe(false);
  });
});
