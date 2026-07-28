/**
 * Usage Activity widget (#796/#797) — SSR smoke tests. The chart is SVG built
 * from the provider payload { windowDays, buckets }; the DAY window is
 * zero-filled client-side in the config's time zone. Interaction (tooltip) is
 * verified in-browser (no DOM test env; conventions:svelte-component-test-gap).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import UsageActivityWidget from './UsageActivityWidget.svelte';

function renderWidget(props: Record<string, unknown>) {
  return render(UsageActivityWidget, { props }).body;
}

// Today in UTC (matches the widget's zero-fill for the default config).
const todayUtc = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());

describe('UsageActivityWidget.svelte', () => {
  it('renders bars, legend, window label, and the sr-only table for a short window', () => {
    const body = renderWidget({
      windowDays: 7,
      buckets: [{ date: todayUtc, reads: 5, writes: 2 }],
    });
    expect(body).toContain('Usage Activity');
    expect(body).toContain('Last 7 days');
    expect(body).toContain('Reads');
    expect(body).toContain('Writes');
    // Bars are paths filled with the series slots.
    expect(body).toContain('var(--series-reads)');
    expect(body).toContain('var(--series-writes)');
    // Accessible table carries the values.
    expect(body).toContain('Read and write events per day');
    expect(body).toContain(todayUtc);
  });

  it('zero-fills the DAY window: 7 days of table rows from one sparse bucket', () => {
    const body = renderWidget({
      windowDays: 7,
      buckets: [{ date: todayUtc, reads: 1, writes: 0 }],
    });
    // 7 zero-filled rows, each with a scope="row" date header.
    expect(body.match(/scope="row"/g)?.length).toBe(7);
  });

  it('switches to a line chart past 31 buckets', () => {
    const buckets = Array.from({ length: 90 }, (_, i) => ({
      date: `2026-0${1 + Math.floor(i / 30)}-${String((i % 30) + 1).padStart(2, '0')}`,
      reads: i,
      writes: 1,
    }));
    const body = renderWidget({ windowDays: 90, buckets, widgetConfig: { bucket: 'WEEK' } });
    // bucket !== DAY renders server buckets as-is; > 31 → line marks.
    expect(body).toContain('viz-line');
    expect(body).not.toContain('viz-line"><!'); // sanity: paths have d attrs
  });

  it('honors an explicit chartStyle over the density heuristic, both ways', () => {
    // Lines at 7 buckets (auto would pick bars)…
    const lines = renderWidget({
      windowDays: 7,
      buckets: [{ date: todayUtc, reads: 5, writes: 2 }],
      widgetConfig: { chartStyle: 'lines' },
    });
    expect(lines).toContain('viz-line');
    // …and bars at 90 buckets (auto would pick lines) — the user's chart.
    const buckets = Array.from({ length: 90 }, (_, i) => ({
      date: `2026-0${1 + Math.floor(i / 30)}-${String((i % 30) + 1).padStart(2, '0')}`,
      reads: i,
      writes: 1,
    }));
    const bars = renderWidget({
      windowDays: 90,
      buckets,
      widgetConfig: { bucket: 'WEEK', chartStyle: 'bars' },
    });
    expect(bars).not.toContain('viz-line');
    // An unknown value falls back to auto (bars at this density).
    const junk = renderWidget({
      windowDays: 7,
      buckets: [{ date: todayUtc, reads: 5, writes: 2 }],
      widgetConfig: { chartStyle: 'sparkles' },
    });
    expect(junk).not.toContain('viz-line');
  });

  it('shows the empty state when the window has no activity', () => {
    const body = renderWidget({ windowDays: 7, buckets: [] });
    expect(body).toContain('No activity in this window.');
  });

  it('shows the degraded state on invalidConfig', () => {
    const body = renderWidget({ windowDays: 7, buckets: [], invalidConfig: true });
    expect(body).toContain('adjust them in Customize');
  });

  it('shows the unsaved hint when no payload exists yet (editor preview)', () => {
    const body = renderWidget({});
    expect(body).toContain('Data loads after saving the layout.');
  });
});
