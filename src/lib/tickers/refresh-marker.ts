/**
 * portal#1462 — a failing page refresh after a COMMITTED apply does not reject in kit: it navigates to the
 * nearest `+error.svelte`, which unmounts the apply panel, so the panel cannot say anything. The panel leaves
 * this marker just before the refresh and the worker error boundary reads it (Xavier's ruling A, #51237).
 *
 * Scoped to the viewer, the worker (the ROUTE's spelling) and one attempt; bounded in time; minimal (no
 * result, no ticker names); taken once. Every access is guarded: storage that is blocked or full must never
 * change what the apply does, only whether the boundary can add its line. The App is not in the scope because
 * the error page cannot read it (the loader that would have said failed), and a worker belongs to one App.
 */
const KEY = 'portal:apply-tickers:refresh-failed';
export const REFRESH_MARKER_KEY = KEY;
/** After this the marker says nothing: a later, unrelated failure must not inherit it. */
export const REFRESH_MARKER_WINDOW_MS = 2 * 60 * 1000;

export interface RefreshMarkerScope {
  viewer: string;
  worker: string;
}

interface Marker extends RefreshMarkerScope {
  v: 1;
  attempt: string;
  at: number;
}

let counter = 0;

function read(): Marker | null {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Partial<Marker> | null;
    if (m && m.v === 1 && typeof m.viewer === 'string' && typeof m.worker === 'string' && typeof m.attempt === 'string' && typeof m.at === 'number') return m as Marker;
  } catch {
    // fall through: a corrupt value is removed by the caller
  }
  return null;
}

/** Leave the marker. Returns its attempt id, or null when storage refused (the apply goes on without it). */
export function setRefreshMarker(scope: RefreshMarkerScope, now: number = Date.now()): string | null {
  try {
    const attempt = `${now.toString(36)}-${(++counter).toString(36)}`;
    const marker: Marker = { v: 1, viewer: scope.viewer, worker: scope.worker, attempt, at: now };
    sessionStorage.setItem(KEY, JSON.stringify(marker));
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
  } catch {
    // nothing to clear when storage is unavailable
  }
}

/**
 * True once for the marker of THIS viewer and worker inside its window, and the marker is consumed. Another
 * worker's live marker is left alone (it says nothing here); another viewer's, an expired, a future-dated or a
 * corrupt one is removed.
 */
export function takeRefreshMarker(scope: RefreshMarkerScope, now: number = Date.now()): boolean {
  try {
    const m = read();
    if (!m) {
      if (sessionStorage.getItem(KEY) !== null) sessionStorage.removeItem(KEY);
      return false;
    }
    const age = now - m.at;
    if (m.viewer !== scope.viewer || age < 0 || age > REFRESH_MARKER_WINDOW_MS) {
      sessionStorage.removeItem(KEY);
      return false;
    }
    if (m.worker !== scope.worker) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
