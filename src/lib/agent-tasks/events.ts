import { t } from '$lib/i18n/t';
import { parseUrnV2, UrnParseError } from '$lib/urn/parse-urn';
import { partyName } from './status';
import type { AgentTaskParty, AgentTeamEvent } from './types';

/**
 * portal#1052 — how one task's history reads (design §5.3); portal#1711 — what
 * a value an event names may be.
 *
 * Each entry is an actor plus a sentence built from `type` and `payload`.
 * The type strings are hadron-server 4c55560a's (`src/lib/agentTasks/events.ts`:
 * TASK_EVENT_TYPES, ASSIGNMENT_EVENT_TYPES, ALARM_EVENT_TYPES, and
 * `task.session-end-requested`). Those closed platform events carry facts the
 * platform defines — ids, short heads, slot ids, outcome words, family and
 * verdict words, links, and a `supersedes` sibling seat task id — never prose,
 * so names come from the event's own parties (`actor`, `subjectWorker`), not
 * from the payload. An App action's own payload (`app.<slug>.<name>…` types,
 * hadron-server#3449) is the App's: opaque, readable by every participant, and
 * shown as text only — never markup, never interpreted, never fetched.
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

/**
 * One value an event names — a pull request, a review node, a receipt, or a
 * superseded sibling seat task. The url check comes first and no value can be
 * two kinds: an https URL's protocol is never `hrn:`, and a v2 URN's is never
 * `https:`. Anything a value is not — malformed, other protocol, relative,
 * non-node URN, non-id — is `text`: no fabricated href, chip or name.
 */
export type EventLink =
  | { label: string; kind: 'url'; value: string }
  | { label: string; kind: 'nodeUrn'; value: string }
  | { label: string; kind: 'task'; value: string; id: string }
  | { label: string; kind: 'text'; value: string };

export type EventSentence =
  | { known: true; text: string; links?: EventLink[]; detail?: string }
  | { known: false; type: string };

/**
 * portal#1711: a value is a web link only when it parses as a URL whose
 * protocol is exactly `https:` (the parser lowercases the scheme, so
 * `HTTPS://` stays valid). Malformed values, `https://` with no host, `http:`,
 * `javascript:`, `data:` and relative paths all fail and stay text.
 */
export function httpsHref(value: string): string | null {
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** portal#1711: a value the v2 grammar parses as a type-`node` URN (a review node); every other value, URN or not, is text. */
export function isNodeUrn(value: string): boolean {
  try {
    return parseUrnV2(value).type === 'node';
  } catch (e) {
    if (e instanceof UrnParseError) return false;
    throw e;
  }
}

/**
 * portal#1711 5c — an App-defined action's type IS its code
 * (hadron-server#3449), shaped per hrn:node:hadronmemory.com:specs:cor:agt:110:01 (**Proposed**,
 * presentation-only — this matcher decides how a code is displayed, never
 * whether it is refused, and must not be cited as Decided event law):
 * the literal `app`, a slug, then one or more name parts, lowercase letters,
 * digits and hyphens; every part starts with a letter or digit; an
 * intermediate name part may end with a hyphen; the slug starts and ends
 * alphanumeric; the whole code ends with a letter or digit and is at most 64
 * characters. The two-atom platform types (`app.credential-act`,
 * `app.manager-act`) never match, and a code the grammar rejects keeps the
 * unknown/raw rendering (ruling 0060 tolerance).
 */
const APP_ACTION_CODE = /^app\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9][a-z0-9-]*)+$/;
const isAppActionCode = (code: string): boolean => code.length <= 64 && APP_ACTION_CODE.test(code) && /[a-z0-9]$/.test(code);

/** A task id as the platform mints it: exactly 32 hex characters. */
const TASK_ID = /^[0-9a-f]{32}$/;

const shortHead = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v) ? v.slice(0, 7) : null);

function link(label: string, v: unknown): EventLink | null {
  const value = str(v);
  if (!value) return null;
  if (httpsHref(value)) return { label, kind: 'url', value };
  if (isNodeUrn(value)) return { label, kind: 'nodeUrn', value };
  return { label, kind: 'text', value };
}

/**
 * portal#1711: `supersedes` names a sibling seat TASK, never a person or
 * worker. Only an exact 32-hex task id becomes a link (the component builds
 * the `{basePath}/tasks/{id}` href); a handle or anything else stays text, and
 * nothing is fetched.
 */
function replacingLink(v: string | null): EventLink | null {
  if (!v) return null;
  const label = t('app.tasks.history.link.replacing', 'replacing');
  return TASK_ID.test(v) ? { label, kind: 'task', value: v.slice(0, 8), id: v } : { label, kind: 'text', value: v };
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
      const base = slot && head
        ? t('app.tasks.history.seat-assigned', 'assigned the {slot} seat at {head}', { slot, head })
        : t('app.tasks.history.seat-assigned-bare', 'assigned a review seat');
      return withLinks(base, [replacingLink(str(p.supersedes))]);
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
      // portal#1711 5e: a payload object with no keys gets no disclosure at all.
      if (isAppActionCode(e.type)) {
        const text = t('app.tasks.history.app-action', 'recorded {code}', { code: e.type });
        const own = p.payload;
        const hasKeys = !!own && typeof own === 'object' && !Array.isArray(own) && Object.keys(own).length > 0;
        return hasKeys ? { known: true, text, detail: JSON.stringify(own, null, 2) } : { known: true, text };
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
