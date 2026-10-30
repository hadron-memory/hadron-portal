/**
 * portal#1462 — a failing page refresh after a COMMITTED apply does not reject in kit: it navigates to the
 * nearest `+error.svelte`, which unmounts the apply panel, so the panel cannot say anything. The panel leaves
 * this marker just before the refresh and the worker error boundary reads it (Xavier's ruling A, #51237).
 *
 * Scoped to the viewer, the worker (its route spelling AND its canonical id/URN), the worker's App and org, and
 * one attempt; bounded in time; minimal (ids only, no result, no ticker names); taken once. Every access is
 * guarded: storage that is blocked or full must never change what the apply does, only whether the boundary can
 * add its line. The App is an explicit discriminator that FAILS CLOSED: a marker is not written without the
 * App id and worker id, and one read back without them says nothing. The error page cannot read the App itself
 * (the loader that would have said failed), so what it can check is the worker's canonical identity (a URN
 * names its App) and, where both sides know it, the org. The attempt must be THIS context's own latest one,
 * so a marker another tab or an earlier load left says nothing (Xavier #51470, George's P2s on 7290cfe4).
 */
const KEY = 'portal:apply-tickers:refresh-failed';
export const REFRESH_MARKER_KEY = KEY;
/** After this the marker says nothing: a later, unrelated failure must not inherit it. */
export const REFRESH_MARKER_WINDOW_MS = 2 * 60 * 1000;

export interface RefreshMarkerScope {
  viewer: string;
  /** The route's spelling of the worker (what the page and the action key by). */
  worker: string;
  /** The worker's canonical id and, when it has one, URN: either spelling of the route resolves to the same worker. */
  workerId: string;
  workerUrn: string | null;
  /** The worker's App: required, the marker fails closed without it. */
  appId: string | null;
  orgId: string | null;
}

/** What the error boundary knows about the page it is showing. */
export interface RefreshMarkerContext {
  viewer: string;
  worker: string;
  orgId?: string | null;
}

interface Marker {
  v: 2;
  viewer: string;
  worker: string;
  workerId: string;
  workerUrn: string | null;
  appId: string;
  orgId: string | null;
  attempt: string;
  at: number;
}

let counter = 0;
// This context's own latest attempt. Module state does not survive a reload or reach another tab, which is the point.
let latestAttempt: string | null = null;

const str = (v: unknown): v is string => typeof v === 'string' && v !== '';

function read(): Marker | null {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Partial<Marker> | null;
    if (
      m && m.v === 2 && str(m.viewer) && str(m.worker) && str(m.workerId) && str(m.appId) && str(m.attempt) && typeof m.at === 'number' &&
      (m.workerUrn === null || str(m.workerUrn)) && (m.orgId === null || str(m.orgId))
    ) return m as Marker;
  } catch {
    // fall through: a corrupt value is removed by the caller
  }
  return null;
}

/** Leave the marker. Returns its attempt id, or null when it could not be written (the apply goes on without it). */
export function setRefreshMarker(scope: RefreshMarkerScope, now: number = Date.now()): string | null {
  if (!str(scope.viewer) || !str(scope.worker) || !str(scope.workerId) || !str(scope.appId)) return null;
  try {
    const attempt = `${now.toString(36)}-${(++counter).toString(36)}`;
    const marker: Marker = {
      v: 2,
      viewer: scope.viewer,
      worker: scope.worker,
      workerId: scope.workerId,
      workerUrn: scope.workerUrn || null,
      appId: scope.appId,
      orgId: scope.orgId || null,
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
export function clearRefreshMarker(attempt?: string): void {
  try {
    if (attempt !== undefined && read()?.attempt !== attempt) return;
    sessionStorage.removeItem(KEY);
    if (attempt === undefined || latestAttempt === attempt) latestAttempt = null;
  } catch {
    // nothing to clear when storage is unavailable
  }
}

/**
 * True once for the marker of THIS viewer, worker and attempt inside its window, and the marker is consumed.
 * A live marker for another worker is left alone (it says nothing here). Another viewer's, an expired,
 * future-dated, corrupt, App-less, foreign-attempt or other-org one is removed.
 */
export function takeRefreshMarker(ctx: RefreshMarkerContext, now: number = Date.now()): boolean {
  try {
    const m = read();
    if (!m) {
      if (sessionStorage.getItem(KEY) !== null) sessionStorage.removeItem(KEY);
      return false;
    }
    const age = now - m.at;
    const sameOrg = !ctx.orgId || !m.orgId || ctx.orgId === m.orgId;
    if (m.viewer !== ctx.viewer || age < 0 || age > REFRESH_MARKER_WINDOW_MS || m.attempt !== latestAttempt || !sameOrg) {
      sessionStorage.removeItem(KEY);
      return false;
    }
    if (ctx.worker !== m.worker && ctx.worker !== m.workerId && ctx.worker !== m.workerUrn) return false;
    sessionStorage.removeItem(KEY);
    latestAttempt = null;
    return true;
  } catch {
    return false;
  }
}
