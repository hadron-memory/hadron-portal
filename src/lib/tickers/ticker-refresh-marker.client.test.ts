/**
 * portal#1497 — the ticker actions' refresh marker, scoped to the TICKER the
 * write was about (the worker-scoped #1462 marker keys on a worker, which a
 * ticker enable or subscriber change has none of). Same pattern, its own
 * storage key: ids only (viewer, canonical App, ticker, action, target worker
 * id), one attempt, bounded in time, fails closed without the App and ticker
 * ids, taken once, and every access guarded so blocked or full storage never
 * turns a committed write into a failure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTickerRefreshMarker,
  setTickerRefreshMarker,
  takeTickerRefreshMarker,
  TICKER_REFRESH_MARKER_KEY,
  TICKER_REFRESH_MARKER_WINDOW_MS,
} from './ticker-refresh-marker';
import { REFRESH_MARKER_KEY, setRefreshMarker } from './refresh-marker';

afterEach(() => sessionStorage.clear());

const SCOPE = {
  viewer: 'u1',
  appId: 'app-1',
  tickerId: 'tk-1',
  // The route's spelling at write time: the same id in the common case, a URN
  // or alias when the URL carried one (#1462 rule — the boundary knows only
  // the URL).
  routeTickerId: 'tk-1',
  action: 'subscribe' as const,
  targetWorkerId: 'w-2',
};
const AT = Date.UTC(2026, 9, 31, 12, 0, 0);

describe('portal#1497 — the ticker refresh marker', () => {
  it('says yes once, for its own viewer, App and ticker, inside the window', () => {
    const attempt = setTickerRefreshMarker(SCOPE, AT);
    expect(attempt).not.toBeNull();
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(true);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1001)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a marker of another App or another ticker says nothing here', () => {
    setTickerRefreshMarker(SCOPE, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-2', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-9' }, AT + 1000)).toBe(false);
  });

  it('a URN-spelled route still claims its marker: EITHER stored spelling matches (#1462 rule)', () => {
    // The write was keyed by the canonical id, but the URL spelled a URN —
    // the boundary reads the URL, so the marker stores both and matches both.
    setTickerRefreshMarker({ ...SCOPE, routeTickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT + 1000)).toBe(true);
    sessionStorage.clear();

    setTickerRefreshMarker({ ...SCOPE, routeTickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(true);
  });

  it('a v1 marker (no route spelling) is refused and removed', () => {
    setTickerRefreshMarker(SCOPE, AT);
    const stored = JSON.parse(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)!);
    delete stored.routeTickerId;
    stored.v = 1;
    sessionStorage.setItem(TICKER_REFRESH_MARKER_KEY, JSON.stringify(stored));
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a marker this context did not write (another tab, an earlier load) says nothing', () => {
    setTickerRefreshMarker(SCOPE, AT);
    const stored = JSON.parse(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)!);
    stored.attempt = 'someone-elses-attempt';
    sessionStorage.setItem(TICKER_REFRESH_MARKER_KEY, JSON.stringify(stored));
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a cleared attempt cannot be consumed even if a marker with its id is put back', () => {
    const attempt = setTickerRefreshMarker(SCOPE, AT)!;
    const raw = sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)!;
    clearTickerRefreshMarker(attempt);
    sessionStorage.setItem(TICKER_REFRESH_MARKER_KEY, raw);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
  });

  it('expires after the window', () => {
    setTickerRefreshMarker(SCOPE, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + TICKER_REFRESH_MARKER_WINDOW_MS + 1)).toBe(false);
  });

  it('fails closed: no viewer, App, ticker id or route spelling, no marker is written', () => {
    expect(setTickerRefreshMarker({ ...SCOPE, appId: '' }, AT)).toBeNull();
    expect(setTickerRefreshMarker({ ...SCOPE, tickerId: '' }, AT)).toBeNull();
    expect(setTickerRefreshMarker({ ...SCOPE, routeTickerId: '' }, AT)).toBeNull();
    expect(setTickerRefreshMarker({ ...SCOPE, viewer: '' }, AT)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('holds ids only: no worker names, no refusal text', () => {
    setTickerRefreshMarker({ ...SCOPE, targetWorkerId: 'w-2' }, AT);
    const raw = sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY) ?? '';
    expect(raw).toContain('w-2');
    expect(raw).not.toContain('Gabriel');
    expect(raw).not.toContain('may or may not');
  });

  it('a corrupt value says nothing and is removed', () => {
    sessionStorage.setItem(TICKER_REFRESH_MARKER_KEY, '{not json');
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('the worker-apply marker (#1462) and the ticker marker never decorate each other', () => {
    setRefreshMarker({ viewer: 'u1', worker: 'w-1', workerId: 'w-1', workerUrn: null, appId: 'app-1', orgId: null }, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
    sessionStorage.clear();

    setTickerRefreshMarker(SCOPE, AT);
    // The worker boundary reads its own key; the ticker marker stays put.
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).not.toBeNull();
  });

  it('a marker for a view with no ticker in it says nothing and is not consumed', () => {
    setTickerRefreshMarker(SCOPE, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: '' }, AT + 1000)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).not.toBeNull();
  });

  it('clearTickerRefreshMarker removes only its own attempt’s marker', () => {
    const attempt = setTickerRefreshMarker(SCOPE, AT);
    setTickerRefreshMarker({ ...SCOPE, action: 'enable', targetWorkerId: null }, AT + 500);
    clearTickerRefreshMarker(attempt!); // the first attempt is not the live one: nothing removed
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).not.toBeNull();
    clearTickerRefreshMarker(); // whatever is there
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });
});
