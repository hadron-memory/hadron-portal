import { describe, expect, it } from 'vitest';
import { createScheduleInput, updateScheduleInput, type StoredSchedule } from './schedule-write';

/**
 * portal#1701 acceptance 2, 4, 5, 6: what the portal SENDS. The approval pin covers the entry graph, not timing, so
 * supplying entryNodeUrn re-captures it even when unchanged; supplying cron or timezone rewrites timing. Hence the
 * rule: send only what the user changed, and read "needs approval" from the server afterwards.
 */
const stored = (over: Partial<StoredSchedule> = {}): StoredSchedule => ({
  id: 's1',
  name: 'Morning digest',
  entryNodeUrn: 'hrn:node:acme.example:ops:digest',
  cron: '0 9 * * *',
  runAt: null,
  timezone: 'Europe/Berlin',
  enabled: true,
  ...over,
});

describe('createScheduleInput', () => {
  it('sends the browser zone explicitly with a recurring choice, and no cron typed by the user', () => {
    expect(
      createScheduleInput({ appRef: 'app-1', name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', zone: 'Europe/Berlin', timing: { kind: 'daily', time: '09:00' } }),
    ).toEqual({ appRef: 'app-1', name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', cron: '0 9 * * *', timezone: 'Europe/Berlin' });
  });

  it('sends a one-shot as runAt and never cron', () => {
    const input = createScheduleInput({ appRef: 'app-1', name: 'Once', entryNodeUrn: 'hrn:node:a:b:c', zone: 'Europe/Berlin', timing: { kind: 'once', at: '2026-11-05T13:30:00.000Z' } });
    expect(input).toEqual({ appRef: 'app-1', name: 'Once', entryNodeUrn: 'hrn:node:a:b:c', runAt: '2026-11-05T13:30:00.000Z', timezone: 'Europe/Berlin' });
    expect('cron' in input).toBe(false);
  });

  it('refuses a create with no zone or a custom timing', () => {
    expect(() => createScheduleInput({ appRef: 'a', name: 'n', entryNodeUrn: 'u', zone: '', timing: { kind: 'daily', time: '09:00' } })).toThrow();
    expect(() => createScheduleInput({ appRef: 'a', name: 'n', entryNodeUrn: 'u', zone: 'UTC', timing: { kind: 'custom', cron: '*/5 * * * *' } })).toThrow();
  });
});

describe('updateScheduleInput', () => {
  it('a timing edit sends cron alone: no name, no entry, no timezone', () => {
    expect(updateScheduleInput(stored(), { name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', timing: { kind: 'daily', time: '10:30' } })).toEqual({ cron: '30 10 * * *' });
  });

  it('an edit to what runs sends entryNodeUrn alone', () => {
    expect(updateScheduleInput(stored(), { name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:other', timing: { kind: 'daily', time: '09:00' } })).toEqual({ entryNodeUrn: 'hrn:node:acme.example:ops:other' });
  });

  it('a rename sends name alone', () => {
    expect(updateScheduleInput(stored(), { name: 'Evening digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', timing: { kind: 'daily', time: '09:00' } })).toEqual({ name: 'Evening digest' });
  });

  it('an unchanged save sends nothing at all', () => {
    expect(updateScheduleInput(stored(), { name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', timing: { kind: 'daily', time: '09:00' } })).toEqual({});
  });

  it('timing left alone (null) omits cron and timezone, so a CLI cron stays byte-identical', () => {
    const cli = stored({ cron: '*/5 9-17 * * 1-5' });
    expect(updateScheduleInput(cli, { name: 'Renamed', entryNodeUrn: cli.entryNodeUrn, timing: null })).toEqual({ name: 'Renamed' });
    expect(updateScheduleInput(cli, { name: cli.name, entryNodeUrn: cli.entryNodeUrn, timing: null })).toEqual({});
  });

  it('re-picking the same plain timing a cron already means is not a change', () => {
    const weekdays = stored({ cron: '0 9 * * 1-5' });
    expect(updateScheduleInput(weekdays, { name: weekdays.name, entryNodeUrn: weekdays.entryNodeUrn, timing: { kind: 'weekdays', days: [1, 2, 3, 4, 5], time: '09:00' } })).toEqual({});
  });

  it('switching a recurring schedule to once sends runAt, and back sends cron', () => {
    expect(updateScheduleInput(stored(), { name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', timing: { kind: 'once', at: '2026-11-05T13:30:00.000Z' } })).toEqual({ runAt: '2026-11-05T13:30:00.000Z' });
    const once = stored({ cron: null, runAt: '2026-11-05T13:30:00.000Z' });
    expect(updateScheduleInput(once, { name: once.name, entryNodeUrn: once.entryNodeUrn, timing: { kind: 'daily', time: '09:00' } })).toEqual({ cron: '0 9 * * *' });
  });

  it('never sends timezone on an edit, even with new timing', () => {
    for (const timing of [{ kind: 'interval', hours: 2 }, { kind: 'once', at: '2026-11-05T13:30:00.000Z' }] as const) {
      expect('timezone' in updateScheduleInput(stored(), { name: 'Morning digest', entryNodeUrn: 'hrn:node:acme.example:ops:digest', timing })).toBe(false);
    }
  });
});

describe('previewScheduleInput (hadron-server#3457)', () => {
  it('carries the entry and the timing and nothing the preview does not use', async () => {
    const { previewScheduleInput } = await import('./schedule-write');
    expect(previewScheduleInput({ appRef: 'a', entryNodeUrn: 'hrn:node:x:m:e', zone: 'Europe/Berlin', timing: { kind: 'daily', time: '09:00' } })).toEqual({ appRef: 'a', entryNodeUrn: 'hrn:node:x:m:e', cron: '0 9 * * *', timezone: 'Europe/Berlin' });
  });
  it('a one-time schedule sends runAt, not a cron; a missing zone is refused here', async () => {
    const { previewScheduleInput } = await import('./schedule-write');
    expect(previewScheduleInput({ appRef: 'a', entryNodeUrn: 'u', zone: 'UTC', timing: { kind: 'once', at: '2027-01-01T08:00:00.000Z' } })).toEqual({ appRef: 'a', entryNodeUrn: 'u', runAt: '2027-01-01T08:00:00.000Z', timezone: 'UTC' });
    expect(() => previewScheduleInput({ appRef: 'a', entryNodeUrn: 'u', zone: ' ', timing: { kind: 'daily', time: '09:00' } })).toThrow(RangeError);
  });
});
