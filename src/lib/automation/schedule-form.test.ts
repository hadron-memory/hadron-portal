import { describe, expect, it } from 'vitest';
import { parseTimingForm } from './schedule-form';

const fd = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

/** portal#1701 — the form's plain controls, read into a Timing on the server. The browser is never trusted for the cron. */
describe('parseTimingForm', () => {
  it('reads every N hours', () => {
    expect(parseTimingForm(fd([['when', 'interval'], ['hours', '6']]), 'UTC')).toEqual({ ok: true, timing: { kind: 'interval', hours: 6 } });
  });

  it('reads daily at a time', () => {
    expect(parseTimingForm(fd([['when', 'daily'], ['time', '09:30']]), 'UTC')).toEqual({ ok: true, timing: { kind: 'daily', time: '09:30' } });
  });

  it('reads chosen weekdays at a time, in any order and ignoring repeats', () => {
    expect(parseTimingForm(fd([['when', 'weekdays'], ['time', '17:00'], ['days', '5'], ['days', '1'], ['days', '1']]), 'UTC')).toEqual({
      ok: true,
      timing: { kind: 'weekdays', days: [1, 5], time: '17:00' },
    });
  });

  it('reads once as the instant of that wall time in the schedule\'s zone', () => {
    expect(parseTimingForm(fd([['when', 'once'], ['date', '2026-11-05'], ['time', '14:30']]), 'Europe/Berlin')).toEqual({
      ok: true,
      timing: { kind: 'once', at: '2026-11-05T13:30:00.000Z' },
    });
  });

  it.each([
    [[['when', 'interval'], ['hours', '0']], 'hours'],
    [[['when', 'interval'], ['hours', '24']], 'hours'],
    [[['when', 'interval'], ['hours', 'x']], 'hours'],
    [[['when', 'interval']], 'hours'],
    [[['when', 'daily'], ['time', '9am']], 'time'],
    [[['when', 'weekdays'], ['time', '09:00']], 'days'],
    [[['when', 'weekdays'], ['time', '09:00'], ['days', '9']], 'days'],
    [[['when', 'once'], ['date', ''], ['time', '09:00']], 'date'],
    [[['when', 'once'], ['date', '2026-03-29'], ['time', '02:30']], 'time'],
    [[['when', 'custom']], 'when'],
    [[], 'when'],
  ] as Array<[Array<[string, string]>, string]>)('refuses %j, naming the field %s', (entries, field) => {
    const r = parseTimingForm(fd(entries), 'Europe/Berlin');
    expect(r).toEqual({ ok: false, field, message: expect.any(String) });
  });

  it('refuses a once whose zone is unknown rather than guessing UTC', () => {
    expect(parseTimingForm(fd([['when', 'once'], ['date', '2026-11-05'], ['time', '14:30']]), 'Not/AZone')).toMatchObject({ ok: false, field: 'time' });
  });
});
