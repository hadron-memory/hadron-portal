import { t } from '$lib/i18n/t';
import { partyName } from './status';
import type { AgentTaskParty, AgentTeamEvent } from './types';

/**
 * portal#1052 — how one task's history reads (design §5.3).
 *
 * Each entry is an actor plus a sentence built from `type` and `payload`.
 * The type strings are hadron-server 4c55560a's (`src/lib/agentTasks/events.ts`:
 * TASK_EVENT_TYPES, ASSIGNMENT_EVENT_TYPES, ALARM_EVENT_TYPES, and
 * `task.session-end-requested`). A payload carries ids, counts, outcome words
 * and flags only, never text, so the names come from the event's own parties
 * (`actor`, `subjectWorker`), not from the payload.
 *
 * A type the portal doesn't describe gets no guessed sentence: it shows the
 * raw type and says so.
 */

/** Who an entry names as its actor: a party, a run, or the platform. */
export type EventActorView =
  | { kind: 'party'; party: AgentTaskParty }
  | { kind: 'run'; runId: string }
  | { kind: 'hadron' };

export function eventActor(e: Pick<AgentTeamEvent, 'actor' | 'actorRunId'>): EventActorView {
  if (e.actor) return { kind: 'party', party: e.actor };
  if (e.actorRunId) return { kind: 'run', runId: e.actorRunId };
  return { kind: 'hadron' };
}

export type EventSentence = { known: true; text: string } | { known: false; type: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** People the page already knows by id (the task's own parties), to name a person a payload names by id only. */
export type KnownPeople = Record<string, string>;

/**
 * The subject's name. A worker comes from the event's `subjectWorker`; a
 * person is named only when the payload's user id is one the page already
 * knows. Otherwise a stand-in says what it is without guessing a name.
 */
function subject(e: Pick<AgentTeamEvent, 'subjectWorker' | 'payload'>, people: KnownPeople): string {
  if (e.subjectWorker) return partyName(e.subjectWorker);
  const p = e.payload ?? {};
  const party = (p.assignee ?? p.to) as { userId?: unknown } | undefined;
  const userId = typeof party?.userId === 'string' ? party.userId : null;
  return (userId && people[userId]) || t('app.tasks.history.a-person', 'a person');
}

/** The editable fields the platform names in a `task.edited` payload (hadron-server#2645), in its order. */
const TASK_EDIT_FIELD_ORDER = ['title', 'description', 'tags', 'requirements', 'startBy', 'closeSessionWhenDone'] as const;

function taskEditFieldLabel(f: (typeof TASK_EDIT_FIELD_ORDER)[number]): string {
  switch (f) {
    case 'title': return t('app.tasks.edit.field.title', 'title');
    case 'description': return t('app.tasks.edit.field.description', 'description');
    case 'tags': return t('app.tasks.edit.field.tags', 'tags');
    case 'requirements': return t('app.tasks.edit.field.requirements', 'requirements');
    case 'startBy': return t('app.tasks.edit.field.start-by', 'start by');
    case 'closeSessionWhenDone': return t('app.tasks.edit.field.close-session', 'end-session choice');
  }
}

/** "a", "a and b", "a, b and c". */
function listWords(xs: string[]): string {
  if (xs.length < 2) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${t('app.tasks.edit.and', 'and')} ${xs[xs.length - 1]}`;
}

export function eventSentence(
  e: Pick<AgentTeamEvent, 'type' | 'payload' | 'subjectWorker'>,
  people: KnownPeople = {},
): EventSentence {
  const p = e.payload ?? {};
  switch (e.type) {
    // server#2644 S1: fixed event vocabulary; never recover a blocker identity from payload ids.
    case 'task.blocker-added':
      return { known: true, text: t('app.tasks.history.blocker-added', 'added a blocker') };
    case 'task.blocker-removed':
      return { known: true, text: t('app.tasks.history.blocker-removed', 'removed a blocker') };
    case 'task.priority':
      return { known: true, text: typeof p.priority === 'number' && Number.isInteger(p.priority) && p.priority >= 1 && p.priority <= 5
        ? t('app.tasks.history.priority', 'set priority to {priority}', { priority: p.priority })
        : t('app.tasks.history.priority-unknown', 'changed the priority') };
    case 'task.released':
      return { known: true, text: t('app.tasks.history.released', 'released this task after its last open blocker ended or was removed') };
    case 'task.created':
      return { known: true, text: t('app.tasks.history.created', 'created this task') };
    case 'task.assigned':
      return { known: true, text: t('app.tasks.history.assigned', 'assigned it to {who}', { who: subject(e, people) }) };
    case 'task.reassigned':
      return { known: true, text: t('app.tasks.history.reassigned', 'reassigned it to {who}', { who: subject(e, people) }) };
    case 'assignment.queued':
      return { known: true, text: t('app.tasks.history.queued', 'queued it: waiting for a matching worker') };
    case 'assignment.matched': {
      const family = str(p.family);
      return {
        known: true,
        text: family
          ? t('app.tasks.history.matched-family', 'matched it to {who} as {family}', { who: subject(e, people), family })
          : t('app.tasks.history.matched', 'matched it to {who}', { who: subject(e, people) }),
      };
    }
    case 'task.started':
      return { known: true, text: t('app.tasks.history.started', 'started it') };
    case 'task.progress':
      return { known: true, text: t('app.tasks.history.progress', 'recorded progress') };
    case 'task.finished': {
      const outcome = str(p.outcome);
      return {
        known: true,
        text: outcome
          ? t('app.tasks.history.finished-outcome', 'finished it: {outcome}', { outcome })
          : t('app.tasks.history.finished', 'finished it'),
      };
    }
    case 'task.cancelled': {
      const open = typeof p.openChildCount === 'number' ? p.openChildCount : 0;
      return {
        known: true,
        text:
          open > 0
            ? t('app.tasks.history.cancelled-children', 'cancelled it, with {n} open subtask(s)', { n: open })
            : t('app.tasks.history.cancelled', 'cancelled it'),
      };
    }
    case 'task.parked':
      return { known: true, text: t('app.tasks.history.parked', 'moved it to backlog') };
    case 'task.ready':
      return { known: true, text: t('app.tasks.history.ready', 'made it ready to be worked') };
    case 'task.edited': {
      // portal#1357 (hadron-server#2645): the payload names the changed fields and never a value.
      const names = TASK_EDIT_FIELD_ORDER.filter((f) => Array.isArray(p.fields) && p.fields.includes(f)).map(taskEditFieldLabel);
      return {
        known: true,
        text: names.length
          ? t('app.tasks.history.edited-fields', 'edited the {fields}', { fields: listWords(names) })
          : t('app.tasks.history.edited', 'edited the task'),
      };
    }
    case 'task.session-end-requested':
      return {
        known: true,
        text: t('app.tasks.history.session-end', 'asked {who} to end its session when done', { who: subject(e, people) }),
      };
    default:
      return { known: false, type: e.type };
  }
}

/** An alarm is told apart by `severity`, never by the type's prefix. */
export function isAlarm(e: Pick<AgentTeamEvent, 'severity'>): boolean {
  return e.severity === 'ALARM';
}

/**
 * The rule an alarm stands for (hrn:node:hadronmemory.com:specs:cor:agt:050:14
 * to :17). `assignment.unassignable` is "Couldn't be assigned": confirmed
 * against hadron-server 4c55560a's
 * ALARM_EVENT_TYPES (design §11.4). Its payload carries only `windowMinutes`,
 * so no reason is shown.
 */
export function alarmRuleName(type: string): string {
  switch (type) {
    case 'stall.not-started':
      return t('app.tasks.alarm.not-started', 'Not started');
    case 'stall.no-progress':
      return t('app.tasks.alarm.no-progress', 'No progress');
    case 'stall.owner-unreactive':
      return t('app.tasks.alarm.owner-unreactive', 'Owner didn’t react');
    case 'assignment.unassignable':
      return t('app.tasks.alarm.unassignable', 'Couldn’t be assigned');
    default:
      return type;
  }
}

/** Every alarm type the portal names; anything else renders its raw type. */
export const KNOWN_ALARM_TYPES = ['stall.not-started', 'stall.no-progress', 'stall.owner-unreactive', 'assignment.unassignable'] as const;
