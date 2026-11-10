/**
 * portal#1052 — a task's history sentences (design §5.3), keyed on
 * hadron-server 4c55560a's event types. A type the portal doesn't describe
 * gets no guessed sentence, and an alarm is told apart by severity.
 */
import { describe, expect, it } from 'vitest';
import { alarmRuleName, eventActor, eventSentence, httpsHref, isAlarm, KNOWN_ALARM_TYPES } from './events';
import type { AgentTaskParty } from './types';

const dara: AgentTaskParty = { id: 'w-dara', kind: 'WORKER', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const ev = (type: string, payload: Record<string, unknown> = {}, subjectWorker: AgentTaskParty | null = null) => ({ type, payload, subjectWorker });

describe('eventSentence', () => {
  it.each([
    ['task.blocker-added', { blockerTaskId: 'concealed' }, null, 'added a blocker'],
    ['task.blocker-removed', { blockerTaskId: 'concealed' }, null, 'removed a blocker'],
    ['task.priority', { priority: 3 }, null, 'set priority to 3'],
    ['task.priority', { priority: 'untrusted' }, null, 'changed the priority'],
    // portal#1392: only an integer 1–5 is shown as a value; anything else is the neutral line.
    ['task.priority', { priority: 1 }, null, 'set priority to 1'],
    ['task.priority', { priority: 5 }, null, 'set priority to 5'],
    ['task.priority', { priority: 0 }, null, 'changed the priority'],
    ['task.priority', { priority: 6 }, null, 'changed the priority'],
    ['task.priority', { priority: 2.5 }, null, 'changed the priority'],
    ['task.priority', { priority: '3' }, null, 'changed the priority'],
    ['task.released', {}, null, 'released this task after its last open blocker ended or was removed'],
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
    // portal#1357: names the changed fields only, in the platform's order; never a value.
    ['task.edited', { fields: ['title', 'startBy', 'closeSessionWhenDone'] }, null, 'edited the title, start by and end-session choice'],
    ['task.edited', { fields: ['requirements'] }, null, 'edited the requirements'],
    ['task.edited', { fields: ['source', 'title'] }, null, 'edited the title'],
    ['task.edited', { fields: ['source'] }, null, 'edited the task'],
    ['task.edited', {}, null, 'edited the task'],
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

// portal#1711 — what a value an event names may be: an https URL (parsed, not
// pattern-matched), a node URN rendered through the shared chip, a superseded
// sibling seat task id, or plain text. Never a fabricated href, chip or name.
describe('portal#1711 — link values', () => {
  const seatAssigned = (supersedes: unknown) => eventSentence(ev('review.seat.assigned', { slot: 'BLIND', head: '92bc8add2930cc83', supersedes }));
  /** Narrow the sentence union: the first link, or undefined when there is none. */
  const link0 = (s: ReturnType<typeof eventSentence>) => (s.known ? s.links?.[0] : undefined);

  it('an https URL is a link; anything else a URL parser refuses is not', () => {
    expect(httpsHref('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
    // The parser lowercases the scheme, so mixed case stays a valid https URL.
    expect(httpsHref('HTTPS://GitHub.com/o/r/pull/1')).toBe('HTTPS://GitHub.com/o/r/pull/1');
    expect(httpsHref('https://')).toBe(null);
    expect(httpsHref('http://github.com/o/r')).toBe(null);
    expect(httpsHref('javascript:alert(1)')).toBe(null);
    expect(httpsHref('data:text/plain,hello')).toBe(null);
    expect(httpsHref('/app/tasks/1')).toBe(null);
    expect(httpsHref('not a url')).toBe(null);
  });

  it('a value is a url link, a node-urn chip, or text — url first, never both', () => {
    const frozen = (pullRequest: unknown) => eventSentence(ev('pr.frozen', { head: '92bc8add2930cc83', pullRequest }));
    expect(frozen('https://github.com/o/r/pull/1')).toEqual({
      known: true,
      text: 'froze the pull request at 92bc8ad',
      links: [{ label: 'Pull request', kind: 'url', value: 'https://github.com/o/r/pull/1' }],
    });
    expect(frozen('hrn:node:acme.com:reviews:r-1')).toEqual({
      known: true,
      text: 'froze the pull request at 92bc8ad',
      links: [{ label: 'Pull request', kind: 'nodeUrn', value: 'hrn:node:acme.com:reviews:r-1' }],
    });
    // A non-node URN is not a chip, and hrn:node: garbage is not either.
    expect(link0(frozen('hrn:mem:acme.com:reviews'))).toMatchObject({ kind: 'text' });
    expect(link0(frozen('hrn:node:not-a-urn'))).toMatchObject({ kind: 'text' });
    // The url check comes first: a URL whose path mentions a URN is still a url.
    expect(link0(frozen('https://acme.com/u/hrn:node:acme.com:reviews:r-1'))).toMatchObject({ kind: 'url' });
  });

  it('a superseded seat task links only on an exact 32-hex id; anything else is text', () => {
    const id = '0123456789abcdef0123456789abcdef';
    expect(seatAssigned(id)).toEqual({
      known: true,
      text: 'assigned the BLIND seat at 92bc8ad',
      links: [{ label: 'replacing', kind: 'task', value: id.slice(0, 8), id }],
    });
    // A handle, a short id, uppercase, non-hex: no guessed URL, still shown.
    expect(link0(seatAssigned('blind-1'))).toMatchObject({ kind: 'text', value: 'blind-1' });
    expect(link0(seatAssigned('0123456789ABCDEF0123456789ABCDEF'))).toMatchObject({ kind: 'text' });
    expect(link0(seatAssigned('0123456789abcdef'))).toMatchObject({ kind: 'text' });
    // No supersedes at all: the sentence carries no links key.
    expect(seatAssigned('')).toEqual({ known: true, text: 'assigned the BLIND seat at 92bc8ad' });
  });
});

// portal#1711 5c — the App action grammar (cor:agt:110:01, Proposed,
// presentation-only): app + slug + one or more name parts; lowercase
// letters/digits/hyphens; a part starts alphanumeric; an intermediate name
// part may end with a hyphen; the whole code ends alphanumeric and is at most
// 64 characters. Rejected codes keep the unknown/raw rendering.
describe('portal#1711 — App action code grammar', () => {
  const known = (type: string) => eventSentence(ev(type, { payload: { n: 1 } }));
  const slug64 = 'app.' + 'a'.repeat(58) + '.x'; // exactly 64, ends alphanumeric

  it.each([
    'app.acme.design-done',
    'app.acme.x-.y',   // an intermediate name part may end with a hyphen
    'app.acme.a.b.c',  // four atoms
    'app.a1.b2',
  ])('%s is an App action', (type) => {
    expect(known(type)).toMatchObject({ known: true });
  });

  it.each([
    // Exactly one past the bound: a longer code would pass under a mutant `<= 65`.
    ['65 characters', 'app.' + 'a'.repeat(59) + '.x'],
    ['slug starts with a hyphen', 'app.-x.y'],
    ['slug ends with a hyphen', 'app.x-.y'],
    ['uppercase', 'APP.acme.x'],
    ['name part starts with a hyphen', 'app.acme.-x'],
    ['code ends with a hyphen', 'app.acme.x-'],
    ['platform two-atom type', 'app.credential-act'],
    ['platform two-atom type', 'app.manager-act'],
  ])('%s is not an App action (unknown/raw row)', (_name, type) => {
    expect(known(type as string)).toEqual({ known: false, type });
  });

  it('the length bound is on the whole code, and 64 exactly passes', () => {
    expect(slug64).toHaveLength(64);
    expect(known(slug64)).toMatchObject({ known: true });
  });
});

// portal#1711 5e — an App payload with no keys gets no disclosure at all.
describe('portal#1711 — empty App payload', () => {
  it('has no detail key when the payload object is empty', () => {
    expect(eventSentence(ev('app.acme.note', { payload: {} }))).toEqual({ known: true, text: 'recorded app.acme.note' });
    expect(eventSentence(ev('app.acme.note', { payload: { a: 1 } }))).toHaveProperty('detail');
    expect(eventSentence(ev('app.acme.note', {}))).toEqual({ known: true, text: 'recorded app.acme.note' });
  });
});
