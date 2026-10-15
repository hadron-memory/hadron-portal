/**
 * #1085 — the usage chart's y-axis labels must fit, whatever the volume.
 *
 * The left padding was a fixed 30px with ticks right-aligned at x=25 and the
 * raw number as the label, so a fifth digit fell off the left edge of the SVG
 * (`10000` rendered as `0000`). Both the dashboard widget and the memory Usage
 * tab render this component.
 *
 * The geometry check uses its OWN width bound (6.2px a character at the 10px
 * `.viz-tick` size: a sans digit there is about 5.6–6.1px, which is why 25px
 * held four digits and not five), not the component's estimate, so the test
 * cannot pass by agreeing with itself. Real glyph rendering is the browser QA
 * leg.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import UsageActivityChart from './UsageActivityChart.svelte';

const todayUtc = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());

/** Each y tick label with the x it is right-aligned at. */
function yTicks(maxReads: number): Array<{ x: number; label: string }> {
  const body = render(UsageActivityChart, {
    props: { windowDays: 7, buckets: [{ date: todayUtc, reads: maxReads, writes: 1 }] },
  }).body;
  return [...body.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="end"[^>]*>\s*([^<]*?)\s*<\/text>/g)].map(
    (m) => ({ x: Number(m[1]), label: m[2] }),
  );
}

const CHAR_PX = 6.2;

describe('UsageActivityChart y-axis (#1085)', () => {
  for (const [digits, max] of [
    [4, 4_000],
    [5, 10_000],
    [5, 45_000],
    [6, 150_000],
    [6, 999_999],
    [7, 1_234_567],
  ] as const) {
    it(`fits every tick label at a ${digits}-digit maximum (${max})`, () => {
      const ticks = yTicks(max);
      expect(ticks).toHaveLength(3);
      for (const { x, label } of ticks) {
        expect(label.length * CHAR_PX, `"${label}" at x=${x}`).toBeLessThanOrEqual(x);
      }
    });
  }

  it('labels a 5-digit axis compactly, never with a clipped raw number', () => {
    expect(yTicks(10_000).map((t) => t.label)).toEqual(['0', '5K', '10K']);
  });

  it('labels a 6-digit axis compactly', () => {
    expect(yTicks(150_000).map((t) => t.label)).toEqual(['0', '100K', '200K']);
  });

  it('keeps small axes as they were', () => {
    expect(yTicks(3).map((t) => t.label)).toEqual(['0', '2', '4']);
    expect(yTicks(3)[0].x).toBe(25);
  });
});
