/**
 * The shared breadcrumb's rendering contract.
 *
 * SSR (`render` from `svelte/server`) rather than a mount: nothing here is a
 * lifecycle, it is markup — so the `node` lane is the right one, per the repo's
 * two-lane rule.
 *
 * Truncation is asserted through the CLASSES rather than by measuring a box,
 * because jsdom has no layout: `offsetWidth` is 0 for everything, so a test
 * that "checked the width" would pass against a component with no truncation
 * at all. The classes are what the browser acts on, so they are the honest
 * thing to pin — and the real rendering is checked in the browser instead.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Breadcrumb from './Breadcrumb.svelte';

function html(items: Array<{ label: string; href?: string; title?: string; chip?: string | null; chipLabel?: string }>) {
  return render(Breadcrumb, { props: { items } }).body;
}

const TRAIL = [
  { label: 'Memories', href: '/app/memories' },
  { label: 'Holger Personal Taxes', href: '/app/memories/m1' },
  { label: 'Nodes', href: '/app/memories/m1/nodes' },
  { label: 'Form: FBAR (FinCEN Form 114)', href: '/app/memories/m1/nodes/n1', title: 'Form: FBAR (FinCEN Form 114) — form-fbar' },
  { label: 'FBAR — penalties and relief procedures' },
];

describe('Breadcrumb', () => {
  it('renders every crumb, and links all but the last', () => {
    const out = html(TRAIL);
    for (const item of TRAIL) expect(out).toContain(item.label);
    expect(out).toContain('href="/app/memories/m1/nodes/n1"');
    // The last crumb is where you already are, so it is not a link even when
    // an href is supplied.
    expect(out).not.toContain('href="/app/memories/m1/nodes/n1/"');
  });

  it('caps every crumb and truncates — not the nav', () => {
    const out = html(TRAIL);
    // One cap per crumb: capping the NAV would shrink the trail toward its
    // last segment, and the last segment is the one a reader most needs whole.
    const capped = out.match(/max-w-\[8rem\]/g) ?? [];
    expect(capped).toHaveLength(TRAIL.length);
    expect(out).toContain('truncate');
    // The ladder widens with the viewport — the phone case is the narrow end,
    // and it is the reason this exists.
    expect(out).toContain('sm:max-w-[12rem]');
    expect(out).toContain('lg:max-w-[18rem]');
  });

  it('truncate is paired with a width to bite against', () => {
    // `truncate` alone is inert on an element with no width constraint, which
    // is the shape this change would silently degrade to if the cap were ever
    // dropped: classes still present, nothing ellipsised.
    const out = html(TRAIL);
    for (const cls of out.match(/class="[^"]*truncate[^"]*"/g) ?? []) {
      expect(cls).toMatch(/max-w-\[8rem\]/);
    }
  });

  it('every crumb carries hover text, defaulting to its own label', () => {
    // A truncated label must stay recoverable. The default matters more than
    // the override: most crumbs pass no title and are exactly the ones whose
    // text is about to be cut.
    const out = html(TRAIL);
    expect(out).toContain('title="Form: FBAR (FinCEN Form 114) — form-fbar"');
    expect(out).toContain('title="Memories"');
  });

  it('marks the current page and hides the separators from assistive tech', () => {
    const out = html(TRAIL);
    // Routed through `t()` — the assertion is on the rendered default, which is
    // what ships today; the point of the check is that the landmark is named at
    // all, and t() is the boundary that lets it be translated later.
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain('aria-current="page"');
    // Exactly one — aria-current on an ancestor would announce the wrong
    // position in the trail.
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toContain('aria-hidden="true"');
  });

  it('a single-crumb trail is the current page, with no separator', () => {
    const out = html([{ label: 'Memories', href: '/app/memories' }]);
    expect(out).toContain('aria-current="page"');
    expect(out).not.toContain('aria-hidden="true"');
  });

  it('escapes a label rather than rendering it as markup', () => {
    // Node names are user-authored and reach this component unsanitized.
    const out = html([{ label: 'A', href: '/a' }, { label: '<img src=x onerror=alert(1)>' }]);
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  // portal#1415 item 1: aria-label on a generic <code> has uneven screen-reader
  // support, so the chip's accessible name must be CONTENT — a visually hidden
  // prefix — not an attribute. The pin is on the text an AT actually reads.
  // MARK tolerates the {#if} comment markers Svelte's SSR emits; \s* is the
  // &nbsp; that keeps "handle" and the value from running together.
  it('a chip with a chipLabel names itself through a visually hidden prefix, not an aria-label', () => {
    const out = html([{ label: 'Root', href: '/r', chip: 'AT3', chipLabel: 'Task handle' }]);
    const MARK = '(?:<!--.*?-->)*';
    expect(out).toMatch(new RegExp(`<code[^>]*data-crumb-chip[^>]*>${MARK}<span class="[^"]*\\bsr-only\\b[^"]*"[^>]*>Task handle\\s*</span>${MARK}AT3</code>`));
    // An aria-label would override the content and reintroduce the original bug.
    expect(out).not.toMatch(/<code[^>]*data-crumb-chip[^>]*aria-label/);
    // The visible chip text itself is untouched: the prefix is additive.
    expect(out).toContain('title="AT3"');
  });

  it('a chip with no chipLabel is a bare code: no prefix, no aria-label', () => {
    const out = html([{ label: 'Root', href: '/r', chip: 'AT3' }]);
    expect(out).toMatch(new RegExp(`<code[^>]*data-crumb-chip[^>]*>${'(?:<!--.*?-->)*'}AT3</code>`));
    expect(out).not.toContain('sr-only');
    expect(out).not.toMatch(/<code[^>]*aria-label/);
  });

  // portal#1415 item 5 (decision B): a trail three levels deep carries three
  // chips of up to 8rem each alongside capped titles, which starves the titles
  // at 390px. The chips hide below `sm` — CSS, not JS, so the SSR'd HTML is
  // already right (hrn:node:hadronmemory.com:hadron-portal:conventions:three-state-responsive-collapse:
  // the viewport half is CSS). Pinned through the classes, as truncation is
  // above: jsdom has no layout to measure.
  it('the chip hides below sm so deep trails keep their titles at phone width', () => {
    const out = html([{ label: 'Root', href: '/r', chip: 'AT3', chipLabel: 'Task handle' }]);
    const code = out.match(/<code[^>]*data-crumb-chip[^>]*>/)?.[0] ?? '';
    const chipClass = code.match(/class="([^"]*)"/)?.[1] ?? '';
    expect(chipClass).toMatch(/(^|\s)hidden(\s|$)/);
    expect(chipClass).toMatch(/(^|\s)sm:inline-block(\s|$)/);
  });
});
