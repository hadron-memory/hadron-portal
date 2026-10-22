import {describe, expect, it} from 'vitest';
import {formatPortalDate, formatPortalDateTime} from './format-portal-date';
describe('metadata dates (#1167)', () => {
  it('uses the memory Info date format for node metadata too', () => {
    expect(formatPortalDate(new Date(2026, 9, 19, 12).toISOString())).toBe('Oct 19, 2026');
  });
  it.each([undefined, null, '', 'not-a-date'])('renders an absent or invalid date as absent', value => {
    expect(formatPortalDate(value)).toBe('—');
  });
});

describe('portal timestamps (#1167)', () => {
  it('uses the same date style while preserving hours, minutes and seconds in local time', () => {
    expect(formatPortalDateTime(new Date(2026, 9, 19, 13, 4, 5).toISOString())).toBe('Oct 19, 2026, 1:04:05 PM');
  });
  it.each([undefined, null, '', 'not-a-date'])('keeps missing or invalid timestamps absent', value => {
    expect(formatPortalDateTime(value)).toBe('—');
  });
});
