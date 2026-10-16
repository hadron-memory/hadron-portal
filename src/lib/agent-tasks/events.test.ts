/**
 * portal#1052 — a task's history sentences (design §5.3), keyed on
 * hadron-server 4c55560a's event types. A type the portal doesn't describe
 * gets no guessed sentence, and an alarm is told apart by severity.
 */
import { describe, expect, it } from 'vitest';
import { alarmRuleName, eventActor, eventSentence, isAlarm, KNOWN_ALARM_TYPES } from './events';
import type { AgentTaskParty } from './types';

const dara: AgentTaskParty = { id: 'w-dara', kind: 'WORKER', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const ev = (type: string, payload: Record<string, unknown> = {}, subjectWorker: AgentTaskParty | null = null) => ({ type, payload, subjectWorker });

describe('eventSentence', () => {
  it.each([
    ['task.created', {}, null, 'created this task'],
    ['task.assigned', {}, dara, 'assigned it to Dara'],
    ['task.reassigned', {}, dara, 'reassigned it to Dara'],
    ['assignment.queued', {}, null, 'queued it: waiting for a matching worker'],
    ['assignment.matched', { family: 'claude' }, dara, 'matched it to Dara as claude'],
    ['task.started', {}, null, 'started it'],
    ['task.progress', {}, null, 'recorded progress'],
    ['task.finished', { outcome: 'succeeded' }, null, 'finished it: succeeded'],
    ['task.cancelled', { openChildCount: 2 }, null, 'cancelled it, with 2 open subtask(s)'],
    ['task.cancelled', { openChildCount: 0 }, null, 'cancelled it'],
    ['task.parked', {}, null, 'moved it to backlog'],
    ['task.ready', {}, null, 'made it ready to be worked'],
    ['task.session-end-requested', {}, dara, 'asked Dara to end its session when done'],
  ])('%s %j reads "%s"', (type, payload, subject, text) => {
    expect(eventSentence(ev(type, payload, subject))).toEqual({ known: true, text });
  });

  it('an assignment to a person names no one it can’t see', () => {
    expect(eventSentence(ev('task.assigned'))).toEqual({ known: true, text: 'assigned it to a person' });
  });

  // Uma's P3 on #1127: a person the page already knows (one of the task's own
  // parties) is named, by the payload's user id.
  it('names a known person by the payload’s user id', () => {
    const people = { u1: 'Holger' };
    expect(eventSentence(ev('task.assigned', { assignee: { userId: 'u1' } }), people)).toEqual({ known: true, text: 'assigned it to Holger' });
    expect(eventSentence(ev('task.reassigned', { to: { userId: 'u1' } }), people)).toEqual({ known: true, text: 'reassigned it to Holger' });
    expect(eventSentence(ev('task.assigned', { assignee: { userId: 'u9' } }), people)).toEqual({ known: true, text: 'assigned it to a person' });
  });

  it('an unknown type returns the raw type and no sentence', () => {
    expect(eventSentence(ev('host.operation.failed'))).toEqual({ known: false, type: 'host.operation.failed' });
  });
});

describe('alarms', () => {
  it('are told apart by severity, not by the type prefix', () => {
    expect(isAlarm({ severity: 'ALARM' })).toBe(true);
    expect(isAlarm({ severity: null })).toBe(false);
  });

  it('name each rule; assignment.unassignable is "Couldn’t be assigned" (design §11.4)', () => {
    expect(KNOWN_ALARM_TYPES.map(alarmRuleName)).toEqual(['Not started', 'No progress', 'Owner didn’t react', 'Couldn’t be assigned']);
    expect(alarmRuleName('stall.something-new')).toBe('stall.something-new');
  });
});

describe('eventActor', () => {
  it('is the party, else the run, else Hadron', () => {
    expect(eventActor({ actor: dara, actorRunId: 'r1' })).toEqual({ kind: 'party', party: dara });
    expect(eventActor({ actor: null, actorRunId: 'r1' })).toEqual({ kind: 'run', runId: 'r1' });
    expect(eventActor({ actor: null, actorRunId: null })).toEqual({ kind: 'hadron' });
  });
});
