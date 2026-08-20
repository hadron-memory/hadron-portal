/**
 * #737 — what a WORKER SESSION's lifecycle fields actually say.
 *
 * Three states, and the distinction the portal exists to make visible is the
 * second versus the third:
 *
 *   OPEN      still bound; work done now is attributed to this worker
 *   ENDED     somebody closed it deliberately, with or without a summary
 *   EXPIRED   the SERVER reaped it — nobody decided anything
 *
 * `endedAt` alone cannot tell ended from expired, because the reaper sets it
 * too. `autoExpiredAt` is the only field that separates "finished" from "died",
 * and until this page nothing in the portal selected it. That is not cosmetic:
 * four worker sessions expired in four days on this team, every one discovered
 * by a write failing rather than by anything saying so, and a reaped session
 * rendered as "Ended" is the portal agreeing with the wrong conclusion.
 *
 * `expiresAt` is the only FORWARD-looking signal on the wire. It is unselected
 * by every other client (hadron-cli#484), so an approaching expiry is invisible
 * everywhere — including to the worker about to lose its binding mid-task.
 *
 * There is no reliable expiry CEILING to quote: observed lifetimes were ~25h,
 * ~27h and 43.6h with continuous activity, so activity extends it by an amount
 * nobody has characterised. Read `expiresAt`; never compute a deadline.
 */

export type WorkerSessionState = 'open' | 'ended' | 'expired';

export interface WorkerSessionLifecycle {
  endedAt?: string | null;
  expiresAt?: string | null;
  autoExpiredAt?: string | null;
}

export interface WorkerSessionStatus {
  state: WorkerSessionState;
  /** For an OPEN session with a known `expiresAt`: ms until it is reaped.
   *  Negative when the deadline has passed but the reaper has not run yet —
   *  which is a real state, not a bug, and must not be shown as time remaining. */
  msUntilExpiry: number | null;
  /** True when an OPEN session is inside the warning window. */
  expiringSoon: boolean;
}

/** How close to expiry an open session starts warning. */
export const EXPIRY_WARNING_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Derive the status. `now` is injected rather than read from the clock so this
 * is pure and testable — and so the caller decides whether "now" is render time
 * or load time.
 */
export function workerSessionStatus(
  session: WorkerSessionLifecycle,
  now: number,
): WorkerSessionStatus {
  // Checked FIRST and independently of endedAt: the reaper sets both, so an
  // `endedAt`-first branch would report every reaped session as a clean close —
  // erasing precisely the distinction this function exists to draw.
  if (session.autoExpiredAt) {
    return { state: 'expired', msUntilExpiry: null, expiringSoon: false };
  }
  if (session.endedAt) {
    return { state: 'ended', msUntilExpiry: null, expiringSoon: false };
  }

  const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : NaN;
  if (Number.isNaN(expiresAt)) {
    // Open, and the server told us nothing about when it dies. Say nothing
    // rather than implying safety — an absent deadline is not a distant one.
    return { state: 'open', msUntilExpiry: null, expiringSoon: false };
  }

  const msUntilExpiry = expiresAt - now;
  return {
    state: 'open',
    msUntilExpiry,
    // A deadline already passed is still worth warning about: the session is
    // live only until the reaper next runs.
    expiringSoon: msUntilExpiry <= EXPIRY_WARNING_MS,
  };
}

/**
 * A coarse "in 1 h" / "12 min ago" for an expiry deadline.
 *
 * Hours are FLOORED, not rounded, and the direction is the point: this labels a
 * deadline, so erring long tells the reader they have more time than they do.
 * Rounding turned 90 minutes into "in 2 h" — an hour of borrowed confidence on
 * the one signal that exists to prevent a session dying mid-task.
 */
export function formatExpiryDistance(ms: number): string {
  const mins = Math.floor(Math.abs(ms) / 60000);
  const unit = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}
