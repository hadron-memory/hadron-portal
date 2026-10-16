/**
 * portal#1052 slice 2 — the Roster's and Alarms list's words (design §6, §7).
 * Every TeamRosterState at hadron-server 4c55560a is pinned; an unknown one
 * never borrows a known state's word.
 */
import { describe, expect, it } from 'vitest';
import {
  ROSTER_STATES,
  alarmWakeSummary,
  filterAlarms,
  parseAlarmFilter,
  rosterAttentionRank,
  rosterSessionLabel,
  rosterStateLabel,
  taskRefLabel,
} from './roster';
import type { AgentAlarm } from './types';

describe('roster states', () => {
  it('names every state in the SDL, each differently', () => {
    expect(ROSTER_STATES.map(rosterStateLabel)).toEqual([
      'Your move', 'Unavailable', 'Assigned, not started', 'Waiting', 'Working', 'No model family', 'Not launchable', 'Available',
    ]);
  });

  it('an unknown state shows its raw value and sorts last', () => {
    expect(rosterStateLabel('SLEEPING')).toBe('Unknown: SLEEPING');
    expect(rosterAttentionRank('SLEEPING')).toBeGreaterThan(rosterAttentionRank('AVAILABLE'));
  });

  it('sorts by attention: your move first, available last', () => {
    expect(rosterAttentionRank('YOUR_MOVE')).toBeLessThan(rosterAttentionRank('UNAVAILABLE'));
    expect(rosterAttentionRank('WORKING')).toBeLessThan(rosterAttentionRank('AVAILABLE'));
  });

  it('a session is live, quiet (bound, not live) or unbound', () => {
    expect(rosterSessionLabel({ bound: true, liveSession: true })).toBe('Live');
    expect(rosterSessionLabel({ bound: true, liveSession: false })).toBe('Quiet');
    expect(rosterSessionLabel({ bound: false, liveSession: false })).toBe('Unbound');
  });
});

it('a task id outside the title read still names a task, never "no task"', () => {
  expect(taskRefLabel('t1', { t1: 'Ship it' })).toBe('Ship it');
  expect(taskRefLabel('01a13cc6af2b7da8', {})).toBe('Task 01a13cc6');
});

const alarm = (id: string, acknowledgedAt: string | null, wakes: AgentAlarm['wakes'] = []): AgentAlarm => ({
  id, type: 'stall.not-started', severity: 'ALARM', taskId: 't1', createdAt: '2026-10-15T10:00:00Z',
  subjectWorker: null, acknowledgedAt, acknowledgedBy: null, wakes,
});

describe('alarm filters', () => {
  it('open is unacknowledged, and is the default', () => {
    const list = [alarm('a', null), alarm('b', '2026-10-15T11:00:00Z')];
    expect(filterAlarms(list, 'open').map((a) => a.id)).toEqual(['a']);
    expect(filterAlarms(list, 'acknowledged').map((a) => a.id)).toEqual(['b']);
    expect(filterAlarms(list, 'all')).toHaveLength(2);
    expect(parseAlarmFilter(null)).toBe('open');
    expect(parseAlarmFilter('nope')).toBe('open');
  });

  it('names the latest owner woken, and the next one due while open', () => {
    const owner = (id: string) => ({ id, kind: 'USER' as const, name: id, urn: null });
    const wakes = [
      { chainIndex: 1, dueAt: '2026-10-15T12:00:00Z', wokenAt: null, owner: owner('boss') },
      { chainIndex: 0, dueAt: '2026-10-15T10:00:00Z', wokenAt: '2026-10-15T10:00:00Z', owner: owner('lead') },
    ];
    const open = alarmWakeSummary(alarm('a', null, wakes));
    expect(open.latestWoken?.owner?.id).toBe('lead');
    expect(open.next?.owner?.id).toBe('boss');
    expect(alarmWakeSummary(alarm('a', '2026-10-15T11:00:00Z', wakes)).next).toBeNull();
  });
});
