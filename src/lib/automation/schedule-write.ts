import { cronFor, timingFromSchedule, type StoredTiming, type Timing } from './schedule-timing';

/**
 * portal#1701 — what the portal SENDS to createAgentSchedule / updateAgentSchedule.
 *
 * The server's approval pin covers the entry graph, not timing or name. But supplying `entryNodeUrn`, `runAsSelf`,
 * `aiConfigName` or `agentRef` re-captures the pin even when the value is unchanged, and supplying `cron` or
 * `timezone` rewrites timing. So an edit sends ONLY the fields the user changed, and never `timezone`: the schedule
 * keeps the zone it was made in. Whether the edit left the schedule needing approval is read from the server's
 * `automationApproval.state` afterwards, never predicted here.
 */

export interface StoredSchedule extends StoredTiming {
  id: string;
  name: string;
  entryNodeUrn: string;
  enabled: boolean;
}

export interface CreateScheduleInput {
  appRef: string;
  name: string;
  entryNodeUrn: string;
  cron?: string;
  runAt?: string;
  timezone: string;
}

export function createScheduleInput(args: { appRef: string; name: string; entryNodeUrn: string; zone: string; timing: Timing }): CreateScheduleInput {
  const { appRef, name, entryNodeUrn, zone, timing } = args;
  // The server would default a missing zone to UTC and the schedule would fire at the wrong hour: refuse here.
  if (!zone.trim()) throw new RangeError('a new schedule needs a timezone');
  const base = { appRef, name, entryNodeUrn, timezone: zone.trim() };
  if (timing.kind === 'once') return { ...base, runAt: timing.at };
  return { ...base, cron: cronFor(timing) };
}

export interface ScheduleUpdateInput {
  enabled?: boolean;
  name?: string;
  entryNodeUrn?: string;
  cron?: string;
  runAt?: string;
}

const same = (a: Timing | null, b: Timing | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields that differ from what is stored. `timing` null means the user left it alone (the form of a custom cron
 * offers no plain control until the user asks to change it). Re-picking what the stored cron already means is not
 * a change either, so `0 9 * * 1-5` re-saved as "weekdays at 09:00" is not rewritten to `0 9 * * 1,2,3,4,5`.
 */
export function updateScheduleInput(current: StoredSchedule, form: { name: string; entryNodeUrn: string; timing: Timing | null }): ScheduleUpdateInput {
  const out: ScheduleUpdateInput = {};
  if (form.name !== current.name) out.name = form.name;
  if (form.entryNodeUrn !== current.entryNodeUrn) out.entryNodeUrn = form.entryNodeUrn;
  if (form.timing && !same(form.timing, timingFromSchedule(current))) {
    if (form.timing.kind === 'once') out.runAt = form.timing.at;
    else out.cron = cronFor(form.timing);
  }
  return out;
}
