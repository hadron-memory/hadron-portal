/**
 * #858 — every horizontal tab strip in the narrow content column scrolls.
 *
 * A strip of tabs in the portal's ~308px column overflows the page at phone
 * widths unless it carries `overflow-x-auto`, and unless each tab carries
 * `shrink-0 whitespace-nowrap` so flex lets the strip scroll rather than
 * compressing the labels into unreadable columns (PR #746, item 2).
 *
 * This is a SOURCE assertion, not a render: the property is about markup that
 * four separate pages must share, and rendering four pages would need four sets
 * of loader fixtures to check one token each. It is deliberately the same
 * predicate #858 proposes for the CI gate, scoped to the files fixed here — so
 * when that gate lands it should subsume this file rather than disagree with it.
 *
 * Why not key on `role="tablist"`: the node detail page's strip (hadron-portal#854)
 * is plain `<button>`s with no ARIA roles at all, so an ARIA-keyed predicate
 * misses the page that is actually broken. The strip's SHAPE is the honest
 * signal — see the issue.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The four strips fixed in #858, with the element that must scroll.
 *
 * The node detail page is deliberately absent: its strip is hadron-portal#854's,
 * whose overflow has two further causes that are nothing to do with tabs.
 */
const STRIPS: Array<{ file: string; label: string; measured: string }> = [
  {
    file: 'src/routes/app/account/+layout.svelte',
    label: '/app/account',
    measured: '335px in a 308px column — 10px of document overflow before the fix',
  },
  {
    file: 'src/routes/app/memories/+page.svelte',
    label: '/app/memories',
    measured: '308px in a 308px column — exactly at the edge',
  },
  {
    file: 'src/routes/app/orgs/[id]/agents/+page.svelte',
    label: '/app/orgs/[id]/agents',
    measured: '308px in a 308px column — exactly at the edge',
  },
  {
    file: 'src/routes/app/assets/+page.svelte',
    label: '/app/assets',
    measured: '274px in a 308px column — had room, guarded anyway',
  },
];

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('#858 — tab strips scroll instead of overflowing', () => {
  it.each(STRIPS)('$label carries overflow-x-auto ($measured)', ({ file }) => {
    expect(source(file)).toMatch(/overflow-x-auto/);
  });

  it.each(STRIPS)('$label gives its tabs shrink-0 and whitespace-nowrap', ({ file }) => {
    // Both halves, because either alone leaves the defect. Without `shrink-0`
    // flex compresses the labels instead of scrolling; without
    // `whitespace-nowrap` a long label wraps to two lines and the strip grows
    // vertically rather than horizontally.
    const src = source(file);
    expect(src).toMatch(/shrink-0/);
    expect(src).toMatch(/whitespace-nowrap/);
  });

  it('/app/assets also lets its nav SHRINK, which is the half that bites there', () => {
    // That nav is a flex item of a `justify-between` row, and a flex item's
    // default `min-width: auto` refuses to shrink below its content — so
    // `overflow-x-auto` alone never engages and the row pushes the file count
    // off-screen instead. Same shape as the AI-config `<select>` that was the
    // last thing still scrolling the App page in #746.
    expect(source('src/routes/app/assets/+page.svelte')).toMatch(/min-w-0/);
  });

  it('the predicate can actually fail', () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail —
    // every assertion above is a substring match against a file that currently
    // passes, which is the shape that silently rots into decoration. This is
    // the string they are looking for, absent.
    const unfixed = '<div class="flex gap-0 border-b border-zinc-200">';
    expect(unfixed).not.toMatch(/overflow-x-auto/);
    expect(unfixed).not.toMatch(/shrink-0/);
  });
});
