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

const scope = { viewer: 'u-1', worker: 'w-A' };
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('refresh marker', () => {
  it('stores only the viewer, the worker, the attempt and the time', () => {
    const attempt = setRefreshMarker(scope, 1000);
    const stored = JSON.parse(sessionStorage.getItem(REFRESH_MARKER_KEY)!);
    expect(Object.keys(stored).sort()).toEqual(['at', 'attempt', 'v', 'viewer', 'worker']);
    expect(stored).toMatchObject({ v: 1, viewer: 'u-1', worker: 'w-A', at: 1000, attempt });
    expect(attempt).toBeTruthy();
  });

  it('is taken once for the same viewer and worker, and is gone afterwards', () => {
    setRefreshMarker(scope, 1000);
    expect(takeRefreshMarker(scope, 1500)).toBe(true);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    expect(takeRefreshMarker(scope, 1600)).toBe(false);
  });

  it('is not another worker’s: it says nothing for a different worker and stays for its own', () => {
    setRefreshMarker(scope, 1000);
    expect(takeRefreshMarker({ viewer: 'u-1', worker: 'w-B' }, 1500)).toBe(false);
    expect(takeRefreshMarker(scope, 1600)).toBe(true);
  });

  it('is not another viewer’s: it says nothing and is removed', () => {
    setRefreshMarker(scope, 1000);
    expect(takeRefreshMarker({ viewer: 'u-2', worker: 'w-A' }, 1500)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });

  it('expires: past the window it says nothing and is removed; one in the future (a bad clock) is not trusted either', () => {
    setRefreshMarker(scope, 1000);
    expect(takeRefreshMarker(scope, 1000 + REFRESH_MARKER_WINDOW_MS + 1)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    setRefreshMarker(scope, 5_000_000);
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
  });

  it('a corrupt value says nothing and is removed', () => {
    sessionStorage.setItem(REFRESH_MARKER_KEY, '{not json');
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    sessionStorage.setItem(REFRESH_MARKER_KEY, JSON.stringify({ v: 2, viewer: 'u-1', worker: 'w-A', attempt: 'x', at: 1000 }));
    expect(takeRefreshMarker(scope, 1500)).toBe(false);
  });

  it('clear with an attempt removes only that attempt’s marker; clear with none removes whatever is there', () => {
    const first = setRefreshMarker(scope, 1000)!;
    const second = setRefreshMarker(scope, 2000)!;
    expect(second).not.toBe(first);
    clearRefreshMarker(first);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).not.toBeNull();
    clearRefreshMarker(second);
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    setRefreshMarker(scope, 3000);
    clearRefreshMarker();
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });

  it('never throws when storage is unavailable: set returns null, take is false, clear is a no-op', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(setRefreshMarker(scope, 1000)).toBeNull();
    expect(takeRefreshMarker(scope, 1000)).toBe(false);
    expect(() => clearRefreshMarker()).not.toThrow();
  });
});
