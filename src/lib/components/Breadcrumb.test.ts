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

function html(items: Array<{ label: string; href?: string; title?: string }>) {
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
});
