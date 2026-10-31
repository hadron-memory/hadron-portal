/**
 * portal#1497 — a failing page refresh after a COMMITTED ticker action (enable,
 * disable, subscribe, unsubscribe) does not reject in kit: it navigates to the
 * route's `+error.svelte`, which unmounts the control, so the control cannot say
 * anything. The control leaves this marker just before the refresh and the
 * ticker route's error boundary reads it.
 *
 * The #1462 worker-apply marker PATTERN, scoped to the entity the write was
 * about — a TICKER, not a worker — under its OWN storage key, so a worker
 * removal's marker can never decorate a ticker action and vice versa. Scoped to
 * the viewer, the canonical App and ticker (both required: the marker fails
 * closed without them), the action, the target worker's id when there is one,
 * and one attempt; bounded in time; ids only (no names, no refusal text); taken
 * once. Every access is guarded: storage that is blocked or full must never
 * change what the action does, only whether the boundary can add its line.
 */
const KEY = 'portal:ticker-actions:refresh-failed';
export const TICKER_REFRESH_MARKER_KEY = KEY;
/** After this the marker says nothing: a later, unrelated failure must not inherit it. */
export const TICKER_REFRESH_MARKER_WINDOW_MS = 2 * 60 * 1000;

export type TickerRefreshAction = 'enable' | 'disable' | 'subscribe' | 'unsubscribe';

export interface TickerRefreshMarkerScope {
  viewer: string;
  /** The ticker's canonical App: required, the marker fails closed without it. */
  appId: string;
  /** The ticker's canonical id: required, the marker fails closed without it. */
  tickerId: string;
  action: TickerRefreshAction;
  /** The worker the action was about, when there was one. An id only, never a name. */
  targetWorkerId: string | null;
}

/** What the ticker route's error boundary knows about the page it is showing. */
export interface TickerRefreshMarkerContext {
  viewer: string;
  appId: string;
  tickerId: string;
}

interface Marker {
  v: 1;
  viewer: string;
  appId: string;
  tickerId: string;
  action: TickerRefreshAction;
  targetWorkerId: string | null;
  attempt: string;
  at: number;
}

let counter = 0;
// This context's own latest attempt. Module state does not survive a reload or reach another tab, which is the point.
let latestAttempt: string | null = null;

const str = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isAction = (v: unknown): v is TickerRefreshAction =>
  v === 'enable' || v === 'disable' || v === 'subscribe' || v === 'unsubscribe';

function read(): Marker | null {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Partial<Marker> | null;
    if (
      m && m.v === 1 && str(m.viewer) && str(m.appId) && str(m.tickerId) && isAction(m.action) &&
      str(m.attempt) && typeof m.at === 'number' && (m.targetWorkerId === null || str(m.targetWorkerId))
    ) return m as Marker;
  } catch {
    // fall through: a corrupt value is removed by the caller
  }
  return null;
}

/** Leave the marker. Returns its attempt id, or null when it could not be written (the action goes on without it). */
export function setTickerRefreshMarker(scope: TickerRefreshMarkerScope, now: number = Date.now()): string | null {
  if (!str(scope.viewer) || !str(scope.appId) || !str(scope.tickerId)) return null;
  try {
    const attempt = `${now.toString(36)}-${(++counter).toString(36)}`;
    const marker: Marker = {
      v: 1,
      viewer: scope.viewer,
      appId: scope.appId,
      tickerId: scope.tickerId,
      action: scope.action,
      targetWorkerId: scope.targetWorkerId || null,
      attempt,
      at: now,
    };
    sessionStorage.setItem(KEY, JSON.stringify(marker));
    latestAttempt = attempt;
    return attempt;
  } catch {
    return null;
  }
}

/** Remove the marker: only the given attempt's when one is named, whatever is there otherwise. */
export function clearTickerRefreshMarker(attempt?: string): void {
  try {
    if (attempt !== undefined && read()?.attempt !== attempt) return;
    sessionStorage.removeItem(KEY);
    if (attempt === undefined || latestAttempt === attempt) latestAttempt = null;
  } catch {
    // nothing to clear when storage is unavailable
  }
}

/**
 * True once for the marker of THIS viewer, App and ticker inside its window, and the marker is
 * consumed. A live marker for another App or ticker is left alone (it says nothing here). Another
 * viewer's, an expired, future-dated, corrupt, foreign-attempt one is removed. A context with no
 * ticker id cannot claim anything, and removes nothing.
 */
export function takeTickerRefreshMarker(ctx: TickerRefreshMarkerContext, now: number = Date.now()): boolean {
  try {
    const m = read();
    if (!m) {
      if (sessionStorage.getItem(KEY) !== null) sessionStorage.removeItem(KEY);
      return false;
    }
    const age = now - m.at;
    if (!str(ctx.viewer) || m.viewer !== ctx.viewer || age < 0 || age > TICKER_REFRESH_MARKER_WINDOW_MS || m.attempt !== latestAttempt) {
      sessionStorage.removeItem(KEY);
      return false;
    }
    if (!str(ctx.appId) || !str(ctx.tickerId) || ctx.appId !== m.appId || ctx.tickerId !== m.tickerId) return false;
    sessionStorage.removeItem(KEY);
    latestAttempt = null;
    return true;
  } catch {
    return false;
  }
}
