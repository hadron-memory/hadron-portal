import { t } from '$lib/i18n/t';
import { relativeTime } from '$lib/tickers/format';

/**
 * portal#1492 (PT1) — a worker's latest terminal report (`Worker.terminal`,
 * hadron-server#2771) in plain words.
 *
 * `status` and `reason` stay strings on purpose: a server ahead of the schema
 * snapshot can send a value this build has never seen, and that must read as
 * fixed copy, never as the raw code (and is never logged).
 *
 * Age is display only: an old report withholds its status/reason from the badge.
 * The stored report is never changed or reinterpreted as another host state.
 */
export type TerminalRead = {
  status: string;
  reason?: string | null;
  checkedAt?: string | null;
  lastTurnAt?: string | null;
};

export type TerminalBadgeState = 'idle' | 'busy' | 'locked' | 'dark' | 'unknown' | 'not-reported' | 'stale';

export type TerminalBadge = {
  state: TerminalBadgeState;
  /** The state in words: "Locked", "Not reported", "Unknown state". */
  label: string;
  /** The reason in words, or null when the report carries none. */
  reason: string | null;
  checkedAt: string | null;
  lastTurnAt: string | null;
};

export function terminalStateLabel(status: string): string {
  switch (status) {
    case 'idle': return t('worker.terminal.state.idle', 'Idle');
    case 'busy': return t('worker.terminal.state.busy', 'Busy');
    case 'locked': return t('worker.terminal.state.locked', 'Locked');
    case 'dark': return t('worker.terminal.state.dark', 'Dark');
    default: return t('worker.terminal.state.unknown', 'Unknown state');
  }
}

export function terminalReasonLabel(reason: string): string {
  switch (reason) {
    case 'model_at_capacity': return t('worker.terminal.reason.model-at-capacity', 'Model at capacity');
    case 'token_budget_exhausted': return t('worker.terminal.reason.token-budget-exhausted', 'Out of usage budget');
    case 'rate_limited': return t('worker.terminal.reason.rate-limited', 'Rate limited');
    case 'guardrail_triggered': return t('worker.terminal.reason.guardrail-triggered', 'Stopped by a safety filter');
    case 'menu_or_question': return t('worker.terminal.reason.menu-or-question', 'Waiting at a menu or question');
    case 'shed_staged_not_relaunched': return t('worker.terminal.reason.shed-staged-not-relaunched', 'Context reset prepared, not restarted');
    case 'unrecognized': return t('worker.terminal.reason.unrecognized', 'Screen not recognized');
    // portal#1938 (Holger) supersedes portal#1495: "Tickers" is the official name, and
    // one missed due wake is "a ticker wake", not a missed ticker (hrn:node:hadronmemory.com:specs:cor:agt:080:15).
    case 'no_turn_for_due_ticker': return t('worker.terminal.reason.no-turn-for-due-ticker', 'Missed its ticker wake');
    case 'no_terminal': return t('worker.terminal.reason.no-terminal', 'No terminal found');
    case 'bare_shell': return t('worker.terminal.reason.bare-shell', 'Agent not running (plain shell)');
    case 'no_agent': return t('worker.terminal.reason.no-agent', 'No agent in the terminal');
    case 'multiple_terminals': return t('worker.terminal.reason.multiple-terminals', 'More than one agent terminal');
    case 'no_screen': return t('worker.terminal.reason.no-screen', 'No screen to read');
    default: return t('worker.terminal.reason.unknown', 'Other reason');
  }
}

const KNOWN_STATES: TerminalBadgeState[] = ['idle', 'busy', 'locked', 'dark'];

/**
 * The badge to show, or null to show nothing.
 *
 * `terminal` is three-valued on purpose:
 * - an object: a report;
 * - `null`: the server answered for this worker and has no report ("Not
 *   reported"), which only a reader who may see internals is told;
 * - `undefined`: nothing was asked or answered (no roster entry, a failed or
 *   hidden read, a field not selected) — no badge, never "Not reported".
 *
 * `internalsVisible` is `workerInternalsVisible(worker)`: the server masks the
 * terminal to null on the same gate as `hasLiveSession`, so for anyone else a
 * null is "not shown to you", which must not read as "not reported".
 */
export function terminalBadge(terminal: TerminalRead | null | undefined, internalsVisible: boolean, now: number): TerminalBadge | null {
  if (!internalsVisible || terminal === undefined) return null;
  if (terminal === null) {
    return { state: 'not-reported', label: t('worker.terminal.state.not-reported', 'Not reported'), reason: null, checkedAt: null, lastTurnAt: null };
  }
  const checked = pastInstant(terminal.checkedAt, now);
  const stale = checked !== null && now - checked > TERMINAL_STALE_AFTER_MS;
  const state = stale ? 'stale' : (KNOWN_STATES as string[]).includes(terminal.status) ? (terminal.status as TerminalBadgeState) : 'unknown';
  return {
    state,
    label: stale ? t('worker.terminal.state.stale', 'Stale') : terminalStateLabel(terminal.status),
    reason: !stale && terminal.reason ? terminalReasonLabel(terminal.reason) : null,
    checkedAt: terminal.checkedAt ?? null,
    lastTurnAt: terminal.lastTurnAt ?? null,
  };
}

/** "Locked: Model at capacity", or just the state when there is no reason. */
export function terminalSummary(badge: TerminalBadge): string {
  return badge.reason ? t('worker.terminal.summary', '{state}: {reason}', { state: badge.label, reason: badge.reason }) : badge.label;
}

/**
 * portal#1495 P2 — a report a moment ahead of the page clock is skew, not a
 * lie: the server accepts a `checkedAt` up to 120 s ahead when it is written
 * (hadron-server `WorkerTerminalReportInput`), so a viewer whose clock trails
 * by a second would otherwise read "time unknown" on the freshest report
 * there is. Display grace: exactly 60 s, inclusive — a finite client display
 * policy, never a judgement about the stored report (Vera, FIT 6568235885).
 */
const FUTURE_GRACE_MS = 60_000;

/** Client display assumption, matching CLI terminalStaleAfter; not a server liveness rule. */
export const TERMINAL_STALE_AFTER_MS = 30 * 60_000;

/** Parsed instant, or null when missing, unparsable, or past the 60 s display grace. */
function pastInstant(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) || at > now + FUTURE_GRACE_MS ? null : at;
}

/** The instant clamped to `now`: an in-grace future reads as the zero age, never "in N sec.". */
function clampedIso(at: number, now: number): string {
  return new Date(Math.min(at, now)).toISOString();
}

/** "checked 5 min. ago"; beyond the grace, a missing or unparsable time is "time unknown". */
export function terminalCheckedAge(checkedAt: string | null | undefined, now: number): string {
  const at = pastInstant(checkedAt, now);
  if (at === null) return t('worker.terminal.checked-unknown', 'checked: time unknown');
  return t('worker.terminal.checked', 'checked {age}', { age: relativeTime(clampedIso(at, now), now) });
}

/** "Last turn: 2 hr. ago"; null (or a time that cannot be right) is "not known". */
export function terminalLastTurn(lastTurnAt: string | null | undefined, now: number): string {
  const at = pastInstant(lastTurnAt, now);
  if (at === null) return t('worker.terminal.last-turn-unknown', 'Last turn: not known');
  return t('worker.terminal.last-turn', 'Last turn: {age}', { age: relativeTime(clampedIso(at, now), now) });
}

/** The page clock the loader returned, as ms; falls back to the instant of the call. */
export function pageClock(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
}
