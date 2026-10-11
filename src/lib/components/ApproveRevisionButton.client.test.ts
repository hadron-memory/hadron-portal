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

// Tailwind v4 emerald fills the button may use, with their sRGB hex.
const EMERALD: Record<string, string> = { '600': '#059669', '700': '#047857', '800': '#065f46', '900': '#064e3b' };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastOnWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

describe('ApproveRevisionButton (#1002)', () => {
  it('keeps white text at WCAG AA (4.5:1) on every fill it can show: rest, hover, dark', () => {
    const b = mountButton({ revision: 7 });
    const fills = [...b.className.matchAll(/(?:^|\s)(?:[\w-]+:)*bg-emerald-(\d{3})\b/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThanOrEqual(2); // rest + hover
    for (const shade of fills) {
      expect(EMERALD[shade], `unknown shade ${shade}`).toBeDefined();
      expect(contrastOnWhite(EMERALD[shade])).toBeGreaterThanOrEqual(4.5);
    }
  });

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
    expect(b.className).toMatch(/\bbg-emerald-\d{3}\b/);
    expect(b.className).not.toMatch(/\bborder-zinc-300\b/);
  });

  it('is disabled while submitting and enabled otherwise', () => {
    expect(mountButton({ revision: 7, submitting: true }).disabled).toBe(true);
    expect(mountButton({ revision: 7 }).disabled).toBe(false);
  });
});
