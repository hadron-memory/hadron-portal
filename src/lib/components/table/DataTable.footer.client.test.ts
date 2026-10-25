/** #1270 — the shared footer contains itself at phone widths.
 *
 * On a 390px phone the pagination row overflowed the document by 14px: the
 * content-sized rows-per-page select (sized by its longest option label)
 * plus Previous/Next cannot sit beside the page indicator in one no-wrap
 * flex line. The footer row and its controls group must WRAP instead of
 * pushing the document wide — the same contract the TableFrame header
 * panel already carries ("wraps at narrow widths").
 *
 * jsdom does not lay out, so this pins the wrap contract on the rendered
 * markup; the geometry red/green evidence (scrollWidth == clientWidth at
 * 390px, footer controls reachable) is the browser receipt in the PR.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import TableFooterHarness from '$lib/test/TableFooterHarness.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function mountFooter() {
  const m = mountComponent(TableFooterHarness as never, {} as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  // The footer carries its own testid (TableFrame does the same for its
  // roots), so the lookup survives new root nodes between it and the frame.
  const footer = m.target.querySelector('[data-testid="table-footer"]') as HTMLElement;
  const select = footer.querySelector('select')!;
  const group = select.parentElement!;
  return { footer, group, select };
}

describe('DataTable footer containment (#1270)', () => {
  it('renders the pagination shape that overflowed: page indicator, select, Previous and Next', () => {
    const { footer, select } = mountFooter();
    expect(select.getAttribute('aria-label')).toBeTruthy();
    expect(footer.textContent).toContain('Page 1 of 2');
    const buttons = [...footer.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toContain('Previous');
    expect(buttons).toContain('Next');
  });

  it('wraps the pagination row and the controls group instead of overflowing the document', () => {
    const { footer, group } = mountFooter();
    // flex-wrap is what turns the phone-width overflow into a second line;
    // without it the controls paint past the viewport (14px on a 390px phone).
    expect(footer.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(group.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
  });
});
