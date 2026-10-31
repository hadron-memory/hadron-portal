/**
 * portal#1497 — the refresh fence a ticker control keeps around a COMMITTED
 * write's reload, in one place instead of a copy per control.
 *
 * A committed enable/disable/subscribe/unsubscribe is followed by a reload
 * (`invalidateAll`, or `goto` to the ticker's first subscriber page). A failure
 * to reload does not undo the write, and in kit it does not even reject — it
 * navigates to the route's error boundary and UNMOUNTS the control, so the
 * control cannot say anything. The fence leaves a marker just before the
 * reload ($lib/tickers/ticker-refresh-marker — the boundary reads it) and is
 * the only thing that may clear it:
 *
 * - the reload landing while the control is still mounted → cleared;
 * - a navigation that is NOT the control's own reload while one is in flight
 *   → the reload was cancelled, cleared;
 * - the control unmounting for any other reason → cleared, EXCEPT when the
 *   page is showing THIS ticker's error page: that unmount is the failed
 *   reload itself, and the marker is exactly what the boundary needs (the
 *   #1462 worker-apply pattern).
 *
 * The marker and the failed-here test both carry the ticker's canonical id AND
 * the route's spelling at the moment of the write (an id or a URN — the URL the
 * boundary later knows may be either), mirroring the worker marker's rule.
 */
import { get } from 'svelte/store';
import { beforeNavigate } from '$app/navigation';
import { page } from '$app/stores';
import { tickerOfPage } from './refresh-page';
import {
  clearTickerRefreshMarker,
  setTickerRefreshMarker,
  type TickerRefreshAction,
} from './ticker-refresh-marker';

export interface TickerRefreshFence {
  /**
   * Leave the marker for a committed action and open the fence. Returns the
   * attempt id (null when the viewer is unknown or storage refused — the
   * action goes on without a marker either way).
   */
  begin(viewerId: string | null, action: TickerRefreshAction, targetWorkerId: string | null): string | null;
  /** Call when the reload's await has settled, either way: closes the in-flight window. */
  refreshSettled(attempt: string | null): void;
  /**
   * Only for an attempt whose control UNMOUNTED during its reload: whether the
   * page store is showing THIS ticker's error page — the failed reload itself,
   * so the marker stays. Anything else may not claim a failed reload later.
   */
  failedHere(attempt: string | null): boolean;
  /** Clear this attempt's marker (a no-op for a null attempt or a foreign one). */
  clear(attempt: string | null): void;
}

export interface TickerRefreshFenceOptions {
  /** The route's App id, read at fence time (a reused route changes it). */
  appId: () => string;
  /** The ticker's canonical id, read at fence time (a reused route changes it). */
  tickerId: () => string;
  /**
   * The first-subscriber-page href this control reloads to, when it reloads by
   * `goto`: that navigation IS the refresh, so its marker survives it. Null
   * when the control refreshes with `invalidateAll` only — then every
   * navigation while in flight cancels.
   */
  reloadHref: (() => string) | null;
}

export function createTickerRefreshFence(opts: TickerRefreshFenceOptions): TickerRefreshFence {
  let pendingAttempt: string | null = null;
  // This attempt's spellings, kept past the own-refresh navigation for
  // failedHere(). TAGGED with its attempt (portal#1502 review): a stale clear
  // from an earlier attempt of the same control must not wipe the newer
  // attempt's ruling — the marker itself is already attempt-guarded, but these
  // ids are what failedHere() reads.
  let pendingIds: { attempt: string; appId: string; canonical: string; route: string } | null = null;

  beforeNavigate((nav: { to?: { url: URL } | null }) => {
    if (pendingAttempt === null) return;
    let own = false;
    if (opts.reloadHref !== null) {
      const to = nav.to?.url;
      if (to) {
        // kit hands over the ENCODED path; the href is built from raw ids, so
        // compare decoded or any id the URI encoder touches breaks the match.
        try {
          own = decodeURIComponent(to.pathname) + to.search === opts.reloadHref();
        } catch {
          own = false;
        }
      }
    }
    if (own) {
      // This navigation IS the reload; the attempt is no longer in flight, but
      // its spellings must survive for the failedHere() ruling after it.
      pendingAttempt = null;
      return;
    }
    clearTickerRefreshMarker(pendingAttempt);
    pendingAttempt = null;
    pendingIds = null;
  });

  return {
    begin(viewerId, action, targetWorkerId) {
      const appId = opts.appId();
      const canonical = opts.tickerId();
      // The route's spelling NOW, while the page store still shows this route
      // under this App; the canonical id when it does not.
      const at = tickerOfPage(get(page));
      const route = at && at.appId === appId ? at.tickerId : canonical;
      const attempt = viewerId
        ? setTickerRefreshMarker({ viewer: viewerId, appId, tickerId: canonical, routeTickerId: route, action, targetWorkerId })
        : null;
      pendingAttempt = attempt;
      pendingIds = attempt === null ? null : { attempt, appId, canonical, route };
      return attempt;
    },
    refreshSettled(attempt) {
      if (pendingAttempt === attempt) pendingAttempt = null;
    },
    failedHere(attempt) {
      if (attempt === null || pendingIds === null || pendingIds.attempt !== attempt) return false;
      const p = get(page);
      const at = tickerOfPage(p);
      return (
        p.error !== null && at !== null && at.appId === pendingIds.appId &&
        (at.tickerId === pendingIds.canonical || at.tickerId === pendingIds.route)
      );
    },
    clear(attempt) {
      if (attempt === null) return;
      if (pendingAttempt === attempt) pendingAttempt = null;
      if (pendingIds !== null && pendingIds.attempt === attempt) pendingIds = null;
      clearTickerRefreshMarker(attempt);
    },
  };
}
