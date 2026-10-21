import {describe, expect, it} from 'vitest';
import {formatPortalDate} from './format-portal-date';
describe('metadata dates (#1167)', () => {
  it('uses the memory Info date format for node metadata too', () => {
    expect(formatPortalDate(new Date(2026, 9, 19, 12).toISOString())).toBe('Oct 19, 2026');
  });
  it.each([undefined, null, '', 'not-a-date'])('renders an absent or invalid date as absent', value => {
    expect(formatPortalDate(value)).toBe('—');
  });
});
