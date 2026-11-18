/**
 * portal#1052 slice 2 — the Roster's and Alarms list's words (design §6, §7).
 * Every TeamRosterState at hadron-server 4c55560a is pinned; an unknown one
 * never borrows a known state's word.
 */
import { describe, expect, it } from 'vitest';
import {
  ROSTER_STATES,
  rosterTaskIds,
  taskRefHandle,
  alarmWakeSummary,
  alarmFilterLabel,
  filterAlarms,
  parseAlarmFilter,
  rosterAttentionRank,
  rosterSessionLabel,
  rosterStateLabel,
  taskRefLabel,
} from './roster';
import type { AgentAlarm, TaskRefs } from './types';

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

describe('task references (portal#1349)', () => {
  it('a resolved reference shows its title and carries its handle', () => {
    const refs = { t1: { id: 't1', handle: 'AT3.405', title: 'Ship it' } };
    expect(taskRefLabel('t1', refs)).toBe('Ship it');
    expect(taskRefHandle('t1', refs)).toBe('AT3.405');
  });
  it('an unavailable one is neutral: no raw id, no stale title, no invented handle', () => {
    for (const refs of [{}, { t1: null }] as TaskRefs[]) {
      expect(taskRefLabel('01a13cc6af2b7da8', refs)).toBe('Task unavailable');
      expect(taskRefHandle('01a13cc6af2b7da8', refs)).toBeNull();
    }
  });
  it('rosterTaskIds is the deduplicated set the Detail cells can name', () => {
    const e = (over: object) => ({ startedTasks: [], pendingTasks: [], waitingOn: [], unreactedChildTask: null, ...over });
    const ids = rosterTaskIds({ workers: [e({ startedTasks: ['a', 'b'] }), e({ pendingTasks: ['b'], waitingOn: ['c'], unreactedChildTask: 'd' })] } as never);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

const alarm = (id: string, acknowledgedAt: string | null, wakes: AgentAlarm['wakes'] = []): AgentAlarm => ({
  id, type: 'stall.not-started', severity: 'ALARM', taskId: 't1', createdAt: '2026-10-15T10:00:00Z',
  subjectWorker: null, acknowledgedAt, acknowledgedBy: null, wakes,
});

describe('alarm filters', () => {
  // portal#2000 (A + D): the default view is In effect, backed by the server's
  // alarmsInEffect filter (#3934) — unacknowledged AND no recorded escalation
  // end. The client cannot re-derive that from a row, so it must not re-filter.
  it('in effect is the server-filtered default and is not re-filtered here', () => {
    const list = [alarm('a', null), alarm('b', '2026-10-15T11:00:00Z')];
    expect(filterAlarms(list, 'in-effect')).toBe(list);
    expect(filterAlarms(list, 'acknowledged').map((a) => a.id)).toEqual(['b']);
    expect(filterAlarms(list, 'all')).toHaveLength(2);
  });

  it('parses the filter values, defaulting to in effect; pre-#2000 open links land there', () => {
    expect(parseAlarmFilter(null)).toBe('in-effect');
    expect(parseAlarmFilter('nope')).toBe('in-effect');
    expect(parseAlarmFilter('in-effect')).toBe('in-effect');
    expect(parseAlarmFilter('open')).toBe('in-effect');
    expect(parseAlarmFilter('acknowledged')).toBe('acknowledged');
    expect(parseAlarmFilter('all')).toBe('all');
    expect(alarmFilterLabel('in-effect')).toBe('In effect');
    // A prototype key must not resolve to an inherited member and leak out of
    // the AlarmFilter union (a lookup map would return Object.constructor).
    for (const hostile of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(parseAlarmFilter(hostile)).toBe('in-effect');
    }
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
