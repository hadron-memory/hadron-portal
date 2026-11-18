import { describe, expect, it } from 'vitest';
import { cronFor, instantFor, timingFromSchedule, timingSentence, type Timing } from './schedule-timing';

/**
 * portal#1701 — a schedule's timing in plain terms. The server stores a 5-field cron (or a one-shot instant) and
 * a timezone; the user thinks in "every day at 9". These pin both directions and the one rule that matters most:
 * a cron the plain controls cannot express is never rewritten to the nearest option (acceptance 5).
 */
describe('timingFromSchedule', () => {
  it.each([
    ['0 */4 * * *', { kind: 'interval', hours: 4 }],
    ['0 9 * * *', { kind: 'daily', time: '09:00' }],
    ['30 17 * * *', { kind: 'daily', time: '17:30' }],
    ['0 9 * * 1,3,5', { kind: 'weekdays', days: [1, 3, 5], time: '09:00' }],
    ['0 9 * * 1-5', { kind: 'weekdays', days: [1, 2, 3, 4, 5], time: '09:00' }],
    ['0 9 * * 7', { kind: 'weekdays', days: [0], time: '09:00' }],
  ] as const)('reads %s as a plain choice', (cron, want) => {
    expect(timingFromSchedule({ cron, runAt: null, timezone: 'UTC' })).toEqual(want);
  });

  it.each(['*/5 * * * *', '0 9 1 * *', '0 9,17 * * *', '0 0 * * 3-1', '15 */3 * * *', '0 */0 * * *', '0 */24 * * *', '0 9 * * 8', '0 9 * *', '@daily', ''])(
    'keeps %j as custom, verbatim',
    (cron) => {
      expect(timingFromSchedule({ cron, runAt: null, timezone: 'UTC' })).toEqual({ kind: 'custom', cron });
    },
  );

  it('reads a one-shot as once, at the stored instant', () => {
    expect(timingFromSchedule({ cron: null, runAt: '2026-11-05T13:30:00.000Z', timezone: 'Europe/Berlin' })).toEqual({
      kind: 'once',
      at: '2026-11-05T13:30:00.000Z',
    });
  });

  it('has no timing for a schedule with neither', () => {
    expect(timingFromSchedule({ cron: null, runAt: null, timezone: 'UTC' })).toBeNull();
  });
});

describe('cronFor', () => {
  it('writes each plain choice as the cron the server stores', () => {
    expect(cronFor({ kind: 'interval', hours: 6 })).toBe('0 */6 * * *');
    expect(cronFor({ kind: 'daily', time: '09:05' })).toBe('5 9 * * *');
    expect(cronFor({ kind: 'weekdays', days: [5, 1, 3], time: '17:30' })).toBe('30 17 * * 1,3,5');
  });

  it('round-trips every plain choice', () => {
    const cases: Timing[] = [
      { kind: 'interval', hours: 12 },
      { kind: 'daily', time: '00:00' },
      { kind: 'weekdays', days: [0, 6], time: '23:59' },
    ];
    for (const timing of cases) {
      expect(timingFromSchedule({ cron: cronFor(timing), runAt: null, timezone: 'UTC' })).toEqual(timing);
    }
  });

  it('refuses a choice it cannot write', () => {
    expect(() => cronFor({ kind: 'interval', hours: 0 })).toThrow();
    expect(() => cronFor({ kind: 'interval', hours: 24 })).toThrow();
    expect(() => cronFor({ kind: 'daily', time: '25:00' })).toThrow();
    expect(() => cronFor({ kind: 'weekdays', days: [], time: '09:00' })).toThrow();
    expect(() => cronFor({ kind: 'weekdays', days: [7], time: '09:00' })).toThrow();
  });
});

describe('timingSentence', () => {
  it('says each timing in the schedule\'s own zone', () => {
    expect(timingSentence({ kind: 'interval', hours: 1 }, 'UTC')).toBe('Every hour (UTC)');
    expect(timingSentence({ kind: 'interval', hours: 4 }, 'UTC')).toBe('Every 4 hours (UTC)');
    expect(timingSentence({ kind: 'daily', time: '09:00' }, 'Europe/Berlin')).toBe('Every day at 09:00 (Europe/Berlin)');
    expect(timingSentence({ kind: 'weekdays', days: [1, 3, 5], time: '17:30' }, 'America/New_York')).toBe(
      'Every Monday, Wednesday and Friday at 17:30 (America/New_York)',
    );
    expect(timingSentence({ kind: 'weekdays', days: [1, 2, 3, 4, 5], time: '09:00' }, 'UTC')).toBe('Every weekday at 09:00 (UTC)');
    expect(timingSentence({ kind: 'weekdays', days: [0], time: '09:00' }, 'UTC')).toBe('Every Sunday at 09:00 (UTC)');
  });

  it('shows a one-shot as the wall time in the schedule\'s zone, not the instant\'s UTC clock', () => {
    // 13:30Z is 14:30 in Berlin in November (CET, UTC+1).
    expect(timingSentence({ kind: 'once', at: '2026-11-05T13:30:00.000Z' }, 'Europe/Berlin')).toBe('Once, on 2026-11-05 at 14:30 (Europe/Berlin)');
    // ... and 15:30 in Berlin in July (CEST, UTC+2) for 13:30Z.
    expect(timingSentence({ kind: 'once', at: '2026-07-05T13:30:00.000Z' }, 'Europe/Berlin')).toBe('Once, on 2026-07-05 at 15:30 (Europe/Berlin)');
  });

  it('shows a custom cron as itself, never rewritten', () => {
    expect(timingSentence({ kind: 'custom', cron: '*/5 * * * *' }, 'UTC')).toBe('On a custom schedule: */5 * * * * (UTC)');
  });
});

describe('instantFor', () => {
  it('turns a wall time in a named zone into the instant the server stores', () => {
    expect(instantFor('2026-11-05', '14:30', 'Europe/Berlin')).toBe('2026-11-05T13:30:00.000Z');
    expect(instantFor('2026-07-05', '14:30', 'Europe/Berlin')).toBe('2026-07-05T12:30:00.000Z');
    expect(instantFor('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    expect(instantFor('2026-01-15', '09:00', 'UTC')).toBe('2026-01-15T09:00:00.000Z');
  });

  it('handles a quarter-hour zone', () => {
    expect(instantFor('2026-11-05', '10:00', 'Asia/Kathmandu')).toBe('2026-11-05T04:15:00.000Z');
  });

  it('refuses a wall time that does not exist, or an unknown zone, with null', () => {
    // Spring forward in Berlin: 02:30 on 2026-03-29 never happens.
    expect(instantFor('2026-03-29', '02:30', 'Europe/Berlin')).toBeNull();
    expect(instantFor('2026-11-05', '14:30', 'Not/AZone')).toBeNull();
    expect(instantFor('2026-02-30', '14:30', 'UTC')).toBeNull();
    expect(instantFor('2026-11-05', '24:00', 'UTC')).toBeNull();
    expect(instantFor('', '14:30', 'UTC')).toBeNull();
  });
});
