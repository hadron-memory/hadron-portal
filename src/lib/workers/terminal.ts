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
 * Age is display only. The stored status is the server's; nothing here derives
 * dark or idle from how old a report is.
 */
export type TerminalRead = {
  status: string;
  reason?: string | null;
  checkedAt?: string | null;
  lastTurnAt?: string | null;
};

export type TerminalBadgeState = 'idle' | 'busy' | 'locked' | 'dark' | 'unknown' | 'not-reported';

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
    case 'no_turn_for_due_ticker': return t('worker.terminal.reason.no-turn-for-due-ticker', 'Missed its tick');
    case 'no_terminal': return t('worker.terminal.reason.no-terminal', 'No terminal found');
    case 'bare_shell': return t('worker.terminal.reason.bare-shell', 'Agent not running (plain shell)');
    case 'no_agent': return t('worker.terminal.reason.no-agent', 'No agent in the terminal');
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
export function terminalBadge(terminal: TerminalRead | null | undefined, internalsVisible: boolean): TerminalBadge | null {
  if (!internalsVisible || terminal === undefined) return null;
  if (terminal === null) {
    return { state: 'not-reported', label: t('worker.terminal.state.not-reported', 'Not reported'), reason: null, checkedAt: null, lastTurnAt: null };
  }
  const state = (KNOWN_STATES as string[]).includes(terminal.status) ? (terminal.status as TerminalBadgeState) : 'unknown';
  return {
    state,
    label: terminalStateLabel(terminal.status),
    reason: terminal.reason ? terminalReasonLabel(terminal.reason) : null,
    checkedAt: terminal.checkedAt ?? null,
    lastTurnAt: terminal.lastTurnAt ?? null,
  };
}

/** "Locked: Model at capacity", or just the state when there is no reason. */
export function terminalSummary(badge: TerminalBadge): string {
  return badge.reason ? t('worker.terminal.summary', '{state}: {reason}', { state: badge.label, reason: badge.reason }) : badge.label;
}

/** Parsed instant, or null when missing, unparsable or after the page clock. */
function pastInstant(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) || at > now ? null : at;
}

/** "checked 5 min. ago"; a future, missing or unparsable time is "time unknown". */
export function terminalCheckedAge(checkedAt: string | null | undefined, now: number): string {
  if (pastInstant(checkedAt, now) === null) return t('worker.terminal.checked-unknown', 'checked: time unknown');
  return t('worker.terminal.checked', 'checked {age}', { age: relativeTime(checkedAt, now) });
}

/** "Last turn: 2 hr. ago"; null (or a time that cannot be right) is "not known". */
export function terminalLastTurn(lastTurnAt: string | null | undefined, now: number): string {
  if (pastInstant(lastTurnAt, now) === null) return t('worker.terminal.last-turn-unknown', 'Last turn: not known');
  return t('worker.terminal.last-turn', 'Last turn: {age}', { age: relativeTime(lastTurnAt, now) });
}

/** The page clock the loader returned, as ms; falls back to the instant of the call. */
export function pageClock(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
}
