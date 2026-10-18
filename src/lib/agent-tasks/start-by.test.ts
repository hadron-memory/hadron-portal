/**
 * portal#1090, Diego's P2-3 on #1135: a `datetime-local` value is converted
 * with the offset of the DATE chosen, not today's. Pinned across New York's
 * DST change (Nov 1 2026): Oct 16 is UTC−4, Dec 1 is UTC−5.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localDateTimeToIso } from './start-by';

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (saved === undefined) delete process.env.TZ;
  else process.env.TZ = saved;
});

describe('localDateTimeToIso', () => {
  it('uses each date’s own offset across a DST change', () => {
    expect(localDateTimeToIso('2026-10-16T09:00')).toBe('2026-10-16T13:00:00.000Z');
    expect(localDateTimeToIso('2026-12-01T09:00')).toBe('2026-12-01T14:00:00.000Z');
  });

  it('empty or malformed input is no instant', () => {
    expect(localDateTimeToIso('')).toBe('');
    expect(localDateTimeToIso('not a date')).toBe('');
  });
});
