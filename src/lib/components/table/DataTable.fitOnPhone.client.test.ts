/** #1954 — phone widths are decided by CSS over markup shipped by SSR, not by
 * a client effect: no matchMedia, no listener, no late correction. The global
 * stub below throws if matchMedia is called, so reintroducing an effect fails
 * the file instead of quietly restoring the hydration flash.
 *
 * #1801's original contract is preserved by the same numbers: single-column
 * fit → 100% on the phone; multi-column → live TanStack sizing; a restored
 * sticky end column → clamped to 170px on the phone only.
 *
 * Lane split (named in the #1973 review): this jsdom file pins the MARKUP
 * contract — which classes and custom properties the component ships. jsdom
 * applies no stylesheet, so class-text assertions here cannot prove the
 * media-query CSS executes; that proof lives in the real-Chromium lane
 * (scripts/test-ai-config-row-menu.mjs and
 * scripts/test-memory-config-bulk-layout.mjs), which measures computed colors
 * and rendered geometry from the SSR markup at actual phone viewports.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import Harness from '$lib/test/DataTableFitOnPhoneHarness.svelte';

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

// The width decision must stay in CSS; called before every mount so a stray
// effect is attributed to whichever test reintroduced it.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => {
    throw new Error('DataTable phone widths must not depend on matchMedia');
  });
});

function mount(fitOnPhone: boolean, multiColumn = false, stickyEndColumn?: string, secondSize = 400, rowClass?: (item: { name: string }) => string) {
  const m = mountComponent(Harness, { fitOnPhone, multiColumn, stickyEndColumn, secondSize, rowClass });
  mounted.push(m);
  flushSync();
  return {
    table: m.target.querySelector<HTMLTableElement>('table')!,
    headers: [...m.target.querySelectorAll<HTMLElement>('th')],
    rows: [...m.target.querySelectorAll<HTMLElement>('tbody tr')],
    cells: [...m.target.querySelectorAll<HTMLElement>('td')],
    separators: [...m.target.querySelectorAll<HTMLElement>('[role="separator"]')],
    style: () => m.target.querySelector<HTMLTableElement>('table')!.getAttribute('style') ?? '',
  };
}

describe('DataTable phone width', () => {
  it('carries both widths as CSS custom properties, decided by a media query, not an effect', () => {
    const { table, headers, separators, style } = mount(true);
    expect(style()).toContain('--table-desktop-w: max(100%, 1600px)');
    expect(style()).toContain('--phone-table-w: 100%');
    expect(table.className).toContain('w-[var(--table-desktop-w)]');
    expect(table.className).toContain('max-sm:w-[var(--phone-table-w)]');
    // The single visible column collapses at the same breakpoint.
    expect(headers[0].className).toContain('max-sm:w-full');
    expect(headers[0].getAttribute('style')).toContain('--col-w: 1600px');
    // No resize handle competes with a 100% column on the phone; desktop keeps it.
    expect(separators).toHaveLength(1);
    expect(separators[0].className).toContain('max-sm:hidden');
    expect(separators[0].getAttribute('aria-valuenow')).toBe('1600');
  });

  it('keeps TanStack sizing and resize controls for a multi-column table on a phone', () => {
    const { headers, separators, style } = mount(true, true);
    expect(style()).toContain('--table-desktop-w: max(100%, 2000px)');
    // Phone width equals desktop width: the fit is a single-column opt-in,
    // enforced in derived state, not by the viewport.
    expect(style()).toContain('--phone-table-w: max(100%, 2000px)');
    expect(headers.map((h) => h.style.getPropertyValue('--col-w'))).toEqual(['1600px', '400px']);
    for (const header of headers) expect(header.className).not.toContain('max-sm:w-full');
    expect(separators).toHaveLength(2);
    for (const separator of separators) expect(separator.className).not.toContain('max-sm:hidden');
  });

  it('bounds a restored end-action width on phones, preserves desktop sizing', () => {
    const { table, headers, separators, style } = mount(false, true, 'second');
    expect(style()).toContain('--table-desktop-w: max(100%, 2000px)');
    // 2000 − (400 − 170): the restored excess no longer covers the viewport.
    expect(style()).toContain('--phone-table-w: max(100%, 1770px)');
    expect(style()).toContain('--phone-end-w: 170px');
    expect(table.className).toContain('max-sm:w-[var(--phone-table-w)]');
    expect(headers[1].className).toContain('max-sm:w-[var(--phone-end-w)]');
    expect(headers[1].getAttribute('style')).toContain('--col-w: 400px');
    // Only the clamped column loses its resize handle on the phone.
    expect(separators[0].className).not.toContain('max-sm:hidden');
    expect(separators[1].className).toContain('max-sm:hidden');
  });

  it('floors a sub-clamp restored end column at 170 on the phone, deliberately', () => {
    // A saved view applies columnSizing raw (no minSize floor), so a stale or
    // hand-edited view can restore an end column BELOW the 170 clamp (100
    // here). The rendered phone width stays a FLAT 170 floor — a deliberate
    // reachability guarantee, not an accident (#1950 pinned it; the overflow
    // script asserts it): the sticky column exists to keep row actions
    // reachable on the phone independent of saved state. min(size, 170) was
    // considered and declined in the #1973 review — it would render such a
    // pathological view's pinned cell as narrow as the raw restore. The
    // accepted cost: the phone table renders up to (170 − size) wider than
    // the desktop total under table-fixed; the subtraction itself still
    // clamps at zero, so the phone never goes BELOW the desktop total.
    const { headers, style } = mount(false, true, 'second', 100);
    // 1700 − (max(100, 170) − 170): no subtraction for a sub-clamp size.
    expect(style()).toContain('--phone-table-w: max(100%, 1700px)');
    expect(style()).toContain('--phone-end-w: 170px');
    expect(headers[1].className).toContain('max-sm:w-[var(--phone-end-w)]');
    expect(headers[1].getAttribute('style')).toContain('--col-w: 100px');
  });

  it('sticky cells inherit the row background and stack on state, not on an ARIA role', () => {
    const { cells } = mount(false, true, 'second');
    const sticky = cells[1].className;
    expect(sticky).toContain('max-sm:sticky');
    expect(sticky).toContain('max-sm:left-0');
    expect(sticky).toContain('max-sm:right-0');
    // Custom and hover row colors survive the sticky cell: it inherits the
    // row's live background instead of repainting white/zinc over it.
    expect(sticky).toContain('max-sm:bg-inherit');
    expect(sticky).not.toContain('max-sm:bg-white');
    // Promotion keys on the menu's own open flag — a descendant's ARIA role
    // (role="menu", role="listbox", …) must not decide paint order.
    expect(sticky).toContain('max-sm:has-[[data-menu-open]]:z-30');
    expect(sticky).toContain('max-sm:focus-within:z-30');
    expect(sticky).not.toContain('has-[[role=menu]]');
  });

  it('leaves ordinary cells untouched when no sticky end column is configured', () => {
    const { cells, separators } = mount(false, true);
    for (const cell of cells) {
      expect(cell.className).not.toContain('max-sm:sticky');
      expect(cell.className).not.toContain('max-sm:bg-inherit');
    }
    for (const separator of separators) expect(separator.className).not.toContain('max-sm:hidden');
  });

  it('keeps TanStack sizing for a single-column table when phone fitting is off', () => {
    // The opt-out for a single visible column: no 100% collapse, no hidden
    // resize handle — the phone rides the same live TanStack widths as the
    // desktop (replaces the pre-#1954 "fitOnPhone off keeps TanStack sizing"
    // pin, now for the CSS-decided path).
    const { headers, separators, style } = mount(false);
    expect(style()).toContain('--phone-table-w: max(100%, 1600px)');
    expect(headers[0].className).not.toContain('max-sm:w-full');
    expect(separators).toHaveLength(1);
    expect(separators[0].className).not.toContain('max-sm:hidden');
  });

  it('keeps the sticky cell on an opaque row background even when a rowClass is supplied', () => {
    // max-sm:bg-inherit is only safe on an opaque row: a see-through row
    // would show scrolled columns under the pinned actions cell. The base
    // background is a load-bearing invariant — present in BOTH color schemes
    // — and a caller's rowClass (dimming, test ids) must not drop it. The
    // computed-color proof that the inheritance actually paints runs in the
    // real-Chromium lane; this pins the markup contract it depends on.
    const { rows } = mount(false, true, 'second', 400, () => 'opacity-60');
    expect(rows).toHaveLength(1);
    expect(rows[0].className).toContain('bg-white');
    expect(rows[0].className).toContain('dark:bg-zinc-950');
    expect(rows[0].className).toContain('opacity-60');
  });
});
