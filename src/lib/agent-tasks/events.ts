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

/** A value an event names (a pull request, a review node, a receipt). `href` is set only for a web URL; anything else is shown as text. */
export interface EventLink { label: string; value: string; href: string | null }

export type EventSentence =
  | { known: true; text: string; links?: EventLink[]; detail?: string }
  | { known: false; type: string };

/** hadron-server#3449 (hrn:node:hadronmemory.com:specs:cor:agt:110:01): `app.<slug>.<name>`, three atoms at least, so the two-atom `app.*` platform types never match. */
const APP_ACTION_CODE = /^app\.[a-z0-9-]+(\.[a-z0-9][a-z0-9-]*)+$/;

const shortHead = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v) ? v.slice(0, 7) : null);

function link(label: string, v: unknown): EventLink | null {
  const value = str(v);
  if (!value) return null;
  return { label, value, href: /^https:\/\//i.test(value) ? value : null };
}

/** The sentence plus the links it names; no `links` key at all when there are none. */
function withLinks(text: string, links: Array<EventLink | null>): EventSentence {
  const present = links.filter((l): l is EventLink => l !== null);
  return present.length ? { known: true, text, links: present } : { known: true, text };
}

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
    // hadron-server#3448: closed protocol facts; the head is shown short, the rest verbatim.
    case 'review.scheduled': {
      const slots = Array.isArray(p.slots) ? p.slots.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
      return { known: true, text: slots.length
        ? t('app.tasks.history.review-scheduled', 'scheduled the reviews: {slots}', { slots: listWords(slots) })
        : t('app.tasks.history.review-scheduled-bare', 'scheduled the reviews') };
    }
    case 'pr.frozen': {
      const head = shortHead(p.head);
      return withLinks(head
        ? t('app.tasks.history.pr-frozen', 'froze the pull request at {head}', { head })
        : t('app.tasks.history.pr-frozen-bare', 'froze the pull request'), [link(t('app.tasks.history.link.pr', 'Pull request'), p.pullRequest)]);
    }
    case 'review.seat.assigned': {
      const slot = str(p.slot);
      const head = shortHead(p.head);
      const supersedes = str(p.supersedes);
      const base = slot && head
        ? t('app.tasks.history.seat-assigned', 'assigned the {slot} seat at {head}', { slot, head })
        : t('app.tasks.history.seat-assigned-bare', 'assigned a review seat');
      return { known: true, text: supersedes ? t('app.tasks.history.seat-replacing', '{base}, replacing {old}', { base, old: supersedes }) : base };
    }
    case 'review.verdict': {
      const verdict = str(p.verdict);
      const slot = str(p.slot);
      const head = shortHead(p.head);
      const text = verdict && slot && head
        ? t('app.tasks.history.verdict', 'recorded {verdict} for the {slot} seat at {head}', { verdict, slot, head })
        : t('app.tasks.history.verdict-bare', 'recorded a review verdict');
      return withLinks(text, [link(t('app.tasks.history.link.node', 'Review node'), p.node), link(t('app.tasks.history.link.receipt', 'Receipt'), p.receipt)]);
    }
    case 'pr.ready': {
      const head = shortHead(p.head);
      return { known: true, text: head
        ? t('app.tasks.history.pr-ready', 'called it ready at {head}', { head })
        : t('app.tasks.history.pr-ready-bare', 'called it ready') };
    }
    default: {
      // hadron-server#3449: an App-defined action's type IS its code; the App's own payload sits under `payload`.
      if (APP_ACTION_CODE.test(e.type)) {
        const text = t('app.tasks.history.app-action', 'recorded {code}', { code: e.type });
        const own = p.payload;
        return own && typeof own === 'object' && !Array.isArray(own) ? { known: true, text, detail: JSON.stringify(own, null, 2) } : { known: true, text };
      }
      return { known: false, type: e.type };
    }
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
