/**
 * portal#1462 (Xavier's ruling A, #51237) — the marker that lets the worker error page say "the tickers were
 * applied" after a post-apply refresh landed on it. Scoped to viewer + worker + one attempt, bounded in time,
 * minimal, consumed once, and never able to break the apply when storage is unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REFRESH_MARKER_KEY,
  REFRESH_MARKER_WINDOW_MS,
  clearRefreshMarker,
  setRefreshMarker,
  takeRefreshMarker,
} from './refresh-marker';
import { refreshScope } from '$lib/test/refreshScope';

const scope = { viewer: 'u-1', worker: 'w-A' };
const full = refreshScope('u-1', 'w-A');
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('refresh marker', () => {
  it('stores only the ids that scope it (viewer, worker spelling and canonical id/URN, App, org), the attempt and the time', () => {
    const attempt = setRefreshMarker(full, 1000);
    const stored = JSON.parse(sessionStorage.getItem(REFRESH_MARKER_KEY)!);
    expect(Object.keys(stored).sort()).toEqual(['appId', 'at', 'attempt', 'orgId', 'v', 'viewer', 'worker', 'workerId', 'workerUrn']);
    expect(stored).toMatchObject({ v: 2, viewer: 'u-1', worker: 'w-A', workerId: 'w-A', appId: 'app-1', at: 1000, attempt });
    expect(attempt).toBeTruthy();
  });

  it('is taken once for the same viewer and worker, and is gone afterwards', () => {
    setRefreshMarker(full, 1000);
    expect(takeRefreshMarker(scope, 1500)).toBe(true);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    expect(takeRefreshMarker(scope, 1600)).toBe(false);
  });

  it('is not another worker’s: it says nothing for a different worker and stays for its own', () => {
    setRefreshMarker(full, 1000);
    expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-B' }, 1500)).toBe(false);
    expect(takeRefreshMarker(scope, 1600)).toBe(true);
  });

  it('is not another viewer’s: it says nothing and is removed', () => {
    setRefreshMarker(full, 1000);
    expect(takeRefreshMarker({ viewer: 'u-2', worker: 'w-A' }, 1500)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });

  it('expires: past the window it says nothing and is removed; one in the future (a bad clock) is not trusted either', () => {
    setRefreshMarker(full, 1000);
    expect(takeRefreshMarker(scope, 1000 + REFRESH_MARKER_WINDOW_MS + 1)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    setRefreshMarker(full, 5_000_000);
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
  });

  it('a corrupt value says nothing and is removed', () => {
    sessionStorage.setItem(REFRESH_MARKER_KEY, '{not json');
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    sessionStorage.setItem(REFRESH_MARKER_KEY, JSON.stringify({ v: 1, viewer: 'u-1', worker: 'w-A', attempt: 'x', at: 1000 }));
    expect(takeRefreshMarker(scope, 1500)).toBe(false);
  });

  it('clear with an attempt removes only that attempt’s marker; clear with none removes whatever is there', () => {
    const first = setRefreshMarker(full, 1000)!;
    const second = setRefreshMarker(full, 2000)!;
    expect(second).not.toBe(first);
    clearRefreshMarker(first);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).not.toBeNull();
    clearRefreshMarker(second);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    setRefreshMarker(full, 3000);
    clearRefreshMarker();
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });

  it('never throws when storage is unavailable: set returns null, take is false, clear is a no-op', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(setRefreshMarker(full, 1000)).toBeNull();
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
    expect(() => clearRefreshMarker()).not.toThrow();
  });

  describe('App discriminator and attempt match (Xavier #51470, George’s P2s on 7290cfe4)', () => {
    it('fails closed at the producer: no App id (or no worker id) means no marker is written', () => {
      expect(setRefreshMarker(refreshScope('u-1', 'w-A', { appId: null }), 1000)).toBeNull();
      expect(setRefreshMarker(refreshScope('u-1', 'w-A', { appId: '' }), 1000)).toBeNull();
      expect(setRefreshMarker(refreshScope('u-1', 'w-A', { workerId: '' }), 1000)).toBeNull();
      expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    });

    it('fails closed at the consumer: a stored marker without an App id says nothing and is removed', () => {
      setRefreshMarker(full, 1000);
      const stored = JSON.parse(sessionStorage.getItem(REFRESH_MARKER_KEY)!);
      stored.appId = '';
      sessionStorage.setItem(REFRESH_MARKER_KEY, JSON.stringify(stored));
      expect(takeRefreshMarker(scope, 1500)).toBe(false);
      expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    });

    it('matches the worker by its canonical identity: the id or the URN, whichever spelling the route used, and nothing else', () => {
      const urn = 'hrn:worker:a.com:team:gaby';
      setRefreshMarker(refreshScope('u-1', 'w-A', { workerId: 'w-A', workerUrn: urn }), 1000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: urn }, 1500)).toBe(true);
      setRefreshMarker(refreshScope('u-1', urn, { workerId: 'w-A', workerUrn: urn }), 2000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-A' }, 2500)).toBe(true);
      setRefreshMarker(refreshScope('u-1', 'w-A', { workerId: 'w-A', workerUrn: urn }), 3000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'hrn:worker:a.com:other:gaby' }, 3500)).toBe(false);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'Gaby' }, 3600)).toBe(false);
    });

    it('fails closed when the org the page is in is known and is not the worker’s App’s org; unknown on either side does not block', () => {
      setRefreshMarker(refreshScope('u-1', 'w-A', { orgId: 'org-1' }), 1000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-A', orgId: 'org-2' }, 1500)).toBe(false);
      setRefreshMarker(refreshScope('u-1', 'w-A', { orgId: 'org-1' }), 2000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-A', orgId: 'org-1' }, 2500)).toBe(true);
      setRefreshMarker(refreshScope('u-1', 'w-A', { orgId: 'org-1' }), 3000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-A', orgId: null }, 3500)).toBe(true);
      setRefreshMarker(refreshScope('u-1', 'w-A', { orgId: null }), 4000);
      expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-A', orgId: 'org-9' }, 4500)).toBe(true);
    });

    it('is matched to this context’s own last attempt: a marker this context did not write (another tab, an earlier load) says nothing', () => {
      setRefreshMarker(full, 1000);
      const stored = JSON.parse(sessionStorage.getItem(REFRESH_MARKER_KEY)!);
      stored.attempt = 'someone-elses-attempt';
      sessionStorage.setItem(REFRESH_MARKER_KEY, JSON.stringify(stored));
      expect(takeRefreshMarker(scope, 1500)).toBe(false);
      expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    });

    it('a cleared attempt cannot be consumed even if a marker with its id is put back', () => {
      const attempt = setRefreshMarker(full, 1000)!;
      const raw = sessionStorage.getItem(REFRESH_MARKER_KEY)!;
      clearRefreshMarker(attempt);
      sessionStorage.setItem(REFRESH_MARKER_KEY, raw);
      expect(takeRefreshMarker(scope, 1500)).toBe(false);
    });
  });
});
