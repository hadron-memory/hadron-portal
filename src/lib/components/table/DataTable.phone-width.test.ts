/** #1954 — the phone width decision is carried by the server-rendered markup
 * itself (custom properties + `max-sm:` utilities), so a phone gets correct
 * column widths at FIRST PAINT. The pre-#1954 component decided phone-ness in
 * a client effect that started `false`, so SSR shipped desktop widths and the
 * phone saw an action-column width flash at hydration — exactly what this
 * file pins out. A server render has no viewport: if the phone width is not
 * IN the markup, no later JavaScript can make the first paint right.
 *
 * Node lane on purpose — SSR markup is the contract (#1801's numbers: a
 * single-column fit table collapses to 100%; a restored sticky end column is
 * clamped to 170px on the phone only, desktop keeps live TanStack sizing).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Harness from '$lib/test/DataTableFitOnPhoneHarness.svelte';

function html(props: Record<string, unknown>): string {
  return render(Harness, { props }).body;
}

describe('DataTable phone width in SSR markup', () => {
  it('ships both widths for a single-column fitOnPhone table', () => {
    const body = html({ fitOnPhone: true });
    expect(body).toContain('--table-desktop-w: max(100%, 1600px)');
    expect(body).toContain('--phone-table-w: 100%');
    expect(body).toContain('w-[var(--table-desktop-w)]');
    expect(body).toContain('max-sm:w-[var(--phone-table-w)]');
    // The one visible column's header collapses too — header width matters
    // (a 100% table under a 1600px header still forces the old width).
    expect(body).toContain('max-sm:w-full');
  });

  it('clamps a restored sticky end column on the phone and keeps desktop sizing', () => {
    const body = html({ multiColumn: true, stickyEndColumn: 'second' });
    expect(body).toContain('--table-desktop-w: max(100%, 2000px)');
    // 2000 − (400 − 170): the restored excess no longer covers the viewport.
    expect(body).toContain('--phone-table-w: max(100%, 1770px)');
    expect(body).toContain('--phone-end-w: 170px');
    expect(body).toContain('max-sm:w-[var(--phone-end-w)]');
  });

  it('never widens the phone table past the desktop total for a sub-clamp restored size', () => {
    // A saved view applies columnSizing raw, with no minSize floor, so a
    // stale or hand-edited view can restore an end column BELOW the 170
    // clamp (100 here). The subtraction clamps at zero instead of going
    // negative — an unclamped 100 − 170 would inflate the phone table to
    // 1770px while the header still clamps to 170, defeating the clamp.
    // The RENDERED width clamps from both sides — min(size, 170) — so the
    // narrow column keeps its own width instead of being widened to 170.
    const body = html({ multiColumn: true, stickyEndColumn: 'second', secondSize: 100 });
    expect(body).toContain('--table-desktop-w: max(100%, 1700px)');
    expect(body).toContain('--phone-table-w: max(100%, 1700px)');
    expect(body).toContain('--phone-end-w: 100px');
    expect(body).not.toContain('1770px');
    expect(body).not.toContain('--phone-end-w: 170px');
  });

  it('keeps a multi-column fitOnPhone table on TanStack sizing at every width', () => {
    const body = html({ fitOnPhone: true, multiColumn: true });
    // Phone width equals desktop width: the fit is a single-column opt-in,
    // enforced in the derived state, not by the viewport.
    expect(body).toContain('--phone-table-w: max(100%, 2000px)');
    expect(body).not.toContain('max-sm:w-full');
  });
});
