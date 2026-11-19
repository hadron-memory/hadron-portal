/**
 * #820 / #829 review — the searchable text the accessors threw away.
 *
 * @copilot's finding on #829 was that the PR claimed date columns also match
 * their WIRE timestamp, and for these two grids they did not: neither row type
 * kept the ISO string, so a reader pasting one from an API response or a log
 * line found nothing. The rows carry it now, and this is what says so.
 *
 * Driven through `makeGlobalFilterFn` rather than by calling the extras
 * directly — the extras are only interesting as the thing the FILTER consults,
 * and a test that calls them in isolation would pass even if the filter never
 * read them.
 */
import { describe, expect, it } from 'vitest';
import { makeGlobalFilterFn } from './global-filter';
import { assetSearchExtras, type AssetSearchFields } from '$lib/components/assets/asset-search';
import { runSearchExtras, type RunSearchFields } from '../../routes/app/orgs/[id]/runs/run-search';

describe('assetSearchExtras', () => {
  const row: AssetSearchFields = { uploaded: 'Sep 6, 2026, 8:00 AM', uploadedAt: '2026-09-06T08:00:00.000Z' };
  // What the ACCESSOR returns for this column: epoch millis, so the column
  // sorts by instant. This is the value the old filter searched, and it is the
  // one thing a reader never has.
  const filter = makeGlobalFilterFn<AssetSearchFields>({}, assetSearchExtras());
  const matches = (needle: string) =>
    filter({ getValue: () => Date.parse(row.uploadedAt), original: row }, 'uploaded', needle);

  it('finds a row by the date the cell is showing', () => {
    expect(matches('Sep 6, 2026')).toBe(true);
  });

  it('finds a row by the wire timestamp a reader pasted', () => {
    expect(matches('2026-09-06T08:00:00.000Z')).toBe(true);
    // A partial paste too — a reader rarely takes the whole string.
    expect(matches('2026-09-06')).toBe(true);
  });

  it('still does not match an unrelated needle', () => {
    // The lazy fix for the original defect is a filter that matches everything,
    // which turns the symptom green and makes search useless.
    expect(matches('2025-01-01')).toBe(false);
    expect(matches('Feb')).toBe(false);
  });
});

describe('runSearchExtras', () => {
  const row: RunSearchFields = {
    status: 'PAUSED',
    started: 'Sep 6, 08:00',
    startedRaw: '2026-09-06T08:00:00.000Z',
    duration: '1m 4s',
  };
  const filter = makeGlobalFilterFn<RunSearchFields>({}, runSearchExtras());

  it('finds a run by the time shown, by the wire timestamp, and not by the epoch', () => {
    const started = (needle: string) =>
      filter({ getValue: () => Date.parse(row.startedRaw), original: row }, 'started', needle);
    expect(started('Sep 6')).toBe(true);
    expect(started('2026-09-06T08:00')).toBe(true);
    expect(started('2027')).toBe(false);
  });

  // Duration is computed from two timestamps, so the rendered string is the
  // only form there is — pinned so the asymmetry is deliberate rather than an
  // omission someone later "fixes" by inventing a wire value for it.
  it('finds a run by its rendered duration, which has no wire form', () => {
    const duration = (needle: string) =>
      filter({ getValue: () => 64000, original: row }, 'duration', needle);
    expect(duration('1m 4s')).toBe(true);
    // The elapsed millis are still matched, since that IS the accessor value.
    expect(duration('64000')).toBe(true);
  });

  // #1766 — the status cell renders `Unknown: {raw}` while the accessor keeps
  // the raw enum name (the status-filter buttons match membership against it),
  // so the word "Unknown" is on screen and invisible to search unless the
  // extras carry the rendered label.
  it('finds a run by the status label the chip shows, not only the enum name', () => {
    const status = (needle: string) =>
      filter({ getValue: () => row.status, original: row }, 'status', needle);
    expect(status('unknown')).toBe(true);
    expect(status('Unknown: PAUSED')).toBe(true);
    // The accessor value — what a reader pastes from a GraphQL response —
    // still matches on its own.
    expect(status('PAUSED')).toBe(true);
    // And this is not a match-everything fix.
    expect(status('RUNNING')).toBe(false);
  });
});
