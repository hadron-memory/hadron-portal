/** #2461 — the scroll cue's CSS is linked to the markup only by class names and a sibling selector, and
 *  jsdom loads no stylesheet, so pin that linkage on the sources. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app.css', 'utf8');
const table = readFileSync('src/lib/components/table/DataTable.svelte', 'utf8');

describe('DataTable scroll cue CSS (#2461)', () => {
  it('shows each shade only when the scroller before it carries that edge mark', () => {
    expect(css).toContain('[data-overflow-end] ~ .table-scroll-cue-end');
    expect(css).toContain('[data-overflow-start] ~ .table-scroll-cue-start');
  });
  it('is hidden by default and themed for dark', () => {
    expect(css).toMatch(/\.table-scroll-cue \{\s*opacity: 0;/);
    expect(css).toContain('.dark .table-scroll-cue');
  });
  it('uses an overlay, not a mask, so fixed row menus and taps are untouched', () => {
    expect(table).toContain('pointer-events-none');
    expect(table).not.toMatch(/class="[^"]*scroll-hint[^"]*overflow-auto/);
  });
  it('the shades use the classes the stylesheet defines', () => {
    for (const c of ['table-scroll-cue-start', 'table-scroll-cue-end']) {
      expect(table).toContain(c);
      expect(css).toContain(`.${c}`);
    }
  });
});
