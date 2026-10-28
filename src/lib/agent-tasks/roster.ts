import { t } from '$lib/i18n/t';
import type { AgentAlarm, TaskRefs, TeamRoster, TeamRosterEntry } from './types';

/**
 * portal#1052 slice 2 — the Roster's and Alarms list's words
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §6, §7).
 *
 * TeamRosterState as hadron-server 4c55560a's SDL has it. Exhaustive: a state
 * the portal doesn't know renders its raw value with "Unknown", never a known
 * state's word.
 */
export const ROSTER_STATES = [
  'YOUR_MOVE',
  'UNAVAILABLE',
  'ASSIGNED_NOT_STARTED',
  'WAITING',
  'WORKING',
  'NO_FAMILY',
  'NOT_LAUNCHABLE',
  'AVAILABLE',
] as const;
export type RosterState = (typeof ROSTER_STATES)[number];

function known(state: string): state is RosterState {
  return (ROSTER_STATES as readonly string[]).includes(state);
}

/** Attention order: whoever needs someone first sorts first. Unknown states sort last. */
export function rosterAttentionRank(state: string): number {
  return known(state) ? ROSTER_STATES.indexOf(state) : ROSTER_STATES.length;
}

export function rosterStateLabel(state: string): string {
  if (!known(state)) return t('app.tasks.roster.state.unknown', 'Unknown: {raw}', { raw: state });
  switch (state) {
    case 'YOUR_MOVE':
      return t('app.tasks.roster.state.your-move', 'Your move');
    case 'UNAVAILABLE':
      return t('app.tasks.roster.state.unavailable', 'Unavailable');
    case 'ASSIGNED_NOT_STARTED':
      return t('app.tasks.roster.state.assigned-not-started', 'Assigned, not started');
    case 'WAITING':
      return t('app.tasks.roster.state.waiting', 'Waiting');
    case 'WORKING':
      return t('app.tasks.roster.state.working', 'Working');
    case 'NO_FAMILY':
      return t('app.tasks.roster.state.no-family', 'No model family');
    case 'NOT_LAUNCHABLE':
      return t('app.tasks.roster.state.not-launchable', 'Not launchable');
    case 'AVAILABLE':
      return t('app.tasks.roster.state.available', 'Available');
  }
}

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

/** Tone is a second cue; the label always carries the state. */
export function rosterStateChipClass(state: string): string {
  switch (state) {
    case 'YOUR_MOVE':
      return `${CHIP} bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200`;
    case 'UNAVAILABLE':
      return `${CHIP} bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200`;
    case 'ASSIGNED_NOT_STARTED':
      return `${CHIP} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200`;
    case 'WAITING':
      return `${CHIP} border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300`;
    case 'WORKING':
      return `${CHIP} bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200`;
    case 'AVAILABLE':
      return `${CHIP} bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200`;
    default:
      return `${CHIP} border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300`;
  }
}

export function unavailableReasonLabel(reason: TeamRosterEntry['unavailableReason']): string | null {
  switch (reason) {
    case 'STALLED':
      return t('app.tasks.roster.reason.stalled', 'Stalled');
    case 'OUT_OF_TOKENS':
      return t('app.tasks.roster.reason.out-of-tokens', 'Out of tokens');
    case 'HOST_DOWN':
      return t('app.tasks.roster.reason.host-down', 'Host down');
    case 'OTHER':
      return t('app.tasks.roster.reason.other', 'Other');
    case null:
      return null;
  }
}

/** Live: a live session. Quiet: bound with an open session that has gone quiet. Unbound: no open session. */
export function rosterSessionLabel(e: Pick<TeamRosterEntry, 'bound' | 'liveSession'>): string {
  if (e.liveSession) return t('app.tasks.roster.session.live', 'Live');
  if (e.bound) return t('app.tasks.roster.session.quiet', 'Quiet');
  return t('app.tasks.roster.session.unbound', 'Unbound');
}

/**
 * A task reference's display (portal#1349): its title when the hydrating read
 * resolved it in this App, else a neutral "Task unavailable". Never a stale
 * title, never the raw id: an unreadable, missing or foreign task all read the same.
 */
export function taskRefLabel(id: string, refs: TaskRefs): string {
  const ref = refs[id];
  return ref ? ref.title : t('app.tasks.task-ref-unavailable', 'Task unavailable');
}

/** The handle a resolved reference carries, or null when it is unavailable. */
export function taskRefHandle(id: string, refs: TaskRefs): string | null {
  return refs[id]?.handle ?? null;
}

// ── Alarms (§7, variant A: read-only) ──────────────────────────────────────

export const ALARM_FILTERS = ['open', 'acknowledged', 'all'] as const;
export type AlarmFilter = (typeof ALARM_FILTERS)[number];

export function parseAlarmFilter(raw: string | null): AlarmFilter {
  return (ALARM_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as AlarmFilter) : 'open';
}

export function alarmFilterLabel(f: AlarmFilter): string {
  switch (f) {
    case 'open':
      return t('app.tasks.alarms.filter.open', 'Open');
    case 'acknowledged':
      return t('app.tasks.alarms.filter.acknowledged', 'Acknowledged');
    case 'all':
      return t('app.tasks.alarms.filter.all', 'All');
  }
}

/** Open is unacknowledged. The server has no such filter yet (design §9 ask 2), so it is applied here. */
export function filterAlarms(alarms: AgentAlarm[], f: AlarmFilter): AgentAlarm[] {
  if (f === 'open') return alarms.filter((a) => !a.acknowledgedAt);
  if (f === 'acknowledged') return alarms.filter((a) => a.acknowledgedAt);
  return alarms;
}

/** The nearest owner an alarm has woken, and the next one due while it is still open. */
export function alarmWakeSummary(a: Pick<AgentAlarm, 'wakes' | 'acknowledgedAt'>) {
  const wakes = [...(a.wakes ?? [])].sort((x, y) => x.chainIndex - y.chainIndex);
  const woken = wakes.filter((w) => w.wokenAt);
  const latestWoken = woken.length ? woken[woken.length - 1] : null;
  const next = a.acknowledgedAt ? null : (wakes.find((w) => !w.wokenAt) ?? null);
  return { wakes, latestWoken, next };
}

/** Every task id a loaded roster's Detail cells can name: the set to hydrate, nothing wider. */
export function rosterTaskIds(roster: Pick<TeamRoster, 'workers'>): string[] {
  const ids = new Set<string>();
  for (const e of roster.workers) {
    for (const id of [...e.startedTasks, ...e.pendingTasks, ...e.waitingOn]) ids.add(id);
    if (e.unreactedChildTask) ids.add(e.unreactedChildTask);
  }
  return [...ids];
}
