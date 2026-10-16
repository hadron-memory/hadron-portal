/** portal#1099 — how a ticker's cadence, quiet hours and times read. */
import { describe, expect, it } from 'vitest';
import { cadenceText, daysText, parseQuietHours, quietHoursSummary, relativeTime, windowText } from './format';

describe('cadenceText', () => {
  it('uses the largest unit that divides the cadence', () => {
    expect(cadenceText(600)).toBe('10 min');
    expect(cadenceText(7200)).toBe('2 h');
    expect(cadenceText(86400)).toBe('1 day');
    expect(cadenceText(5400)).toBe('90 min');
    expect(cadenceText(90)).toBe('90 s');
  });
  it('says None for no cadence', () => {
    expect(cadenceText(null)).toBe('None');
    expect(cadenceText(0)).toBe('None');
  });
});

describe('quiet hours', () => {
  const q = { timezone: 'Europe/Berlin', windows: [{ days: [5, 1, 2, 3, 4], from: '22:00', to: '07:00' }] };

  it('summarizes the first window with its zone, marking an overnight window', () => {
    expect(quietHoursSummary(q)).toBe('22:00–07:00 Mon–Fri (overnight, ends next day) (Europe/Berlin)');
  });
  it('counts further windows as +N more, never listing them all in a cell', () => {
    const two = { ...q, windows: [...q.windows, { days: [6, 7], from: '00:00', to: '10:00' }] };
    expect(quietHoursSummary(two)).toMatch(/ \+1 more$/);
  });
  it('None when there are no quiet hours', () => {
    expect(quietHoursSummary(null)).toBe('None');
  });
  it('says the schedule isn’t shown rather than guessing one from an unexpected shape', () => {
    expect(parseQuietHours({ tz: 'x' })).toBe('invalid');
    expect(parseQuietHours({ timezone: 'UTC', windows: [{ days: [8], from: '22:00', to: '07:00' }] })).toBe('invalid');
    expect(quietHoursSummary('22:00-07:00')).toBe('Schedule not shown (unrecognized format)');
  });
  it('collapses runs of days and keeps short runs listed', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysText([1, 3])).toBe('Mon, Wed');
    expect(daysText([6, 7])).toBe('Sat, Sun');
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });
  it('a same-day window has no overnight note', () => {
    expect(windowText({ days: [1], from: '12:00', to: '13:00' })).toBe('12:00–13:00 Mon');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  it('reads forward and back', () => {
    expect(relativeTime('2026-10-16T10:10:00Z', now)).toBe('in 10 min.');
    expect(relativeTime('2026-10-16T07:00:00Z', now)).toBe('3 hr. ago');
  });
  it('a dash for no time', () => {
    expect(relativeTime(null, now)).toBe('—');
  });
});
