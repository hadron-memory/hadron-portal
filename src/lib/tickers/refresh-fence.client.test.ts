/**
 * portal#1502 (review, Gaby P3) — the shared refresh fence's clear() is
 * documented as "a no-op for a null attempt or a foreign one", but it wiped
 * `pendingIds` for ANY attempt. A stale clear from an earlier attempt of the
 * same control (a second submit after the first's reload settled late) then
 * destroyed the NEWER attempt's failed-here ruling, so on unmount the newer
 * marker was cleared instead of surviving for the error boundary that needs
 * it (#1462 pattern). The marker itself is already attempt-guarded
 * ($lib/tickers/ticker-refresh-marker); the ids the ruling reads were not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import { createTickerRefreshFence } from './refresh-fence';

const opts = {
  appId: () => 'app-1',
  tickerId: () => 'tk-1',
  reloadHref: () => '/app/apps/app-1/tickers/tk-1',
};

/** The page store showing this ticker's route as an ERROR page (a failed reload). */
function showErrorPage() {
  page.set({
    url: new URL('http://localhost/app/apps/app-1/tickers/tk-1'),
    params: {},
    route: { id: null },
    status: 500,
    error: new Error('refresh failed'),
    data: {},
    form: null,
  });
}

const storedAttempt = () => {
  const raw = sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY);
  return raw === null ? null : (JSON.parse(raw) as { attempt: string }).attempt;
};

afterEach(() => {
  sessionStorage.clear();
  resetStubPage();
  resetNavigationGuards();
});

describe('createTickerRefreshFence: a stale clear must not touch the newer attempt', () => {
  it('the marker is single-slot: the second begin owns it', () => {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1');
    const fence = createTickerRefreshFence(opts);
    const a1 = fence.begin('u-1', 'unsubscribe', 'w-2');
    const a2 = fence.begin('u-1', 'subscribe', 'w-3');
    expect(a1).toBeTruthy();
    expect(a2).toBeTruthy();
    expect(a2).not.toBe(a1);
    expect(storedAttempt()).toBe(a2);
  });

  it('a stale clear of the FIRST attempt preserves the second’s marker AND its failed-here ruling', () => {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1');
    const fence = createTickerRefreshFence(opts);
    const a1 = fence.begin('u-1', 'unsubscribe', 'w-2');
    const a2 = fence.begin('u-1', 'subscribe', 'w-3');
    // The first attempt's callback settles late and clears — after the second
    // submit already began. Only the FIRST attempt's own state may go.
    fence.clear(a1);
    expect(storedAttempt()).toBe(a2);
    showErrorPage();
    expect(fence.failedHere(a2)).toBe(true);
  });

  it('clearing the OWNING attempt still removes its marker', () => {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1');
    const fence = createTickerRefreshFence(opts);
    const a1 = fence.begin('u-1', 'unsubscribe', 'w-2');
    const a2 = fence.begin('u-1', 'subscribe', 'w-3');
    fence.clear(a2);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
    showErrorPage();
    expect(fence.failedHere(a2)).toBe(false);
  });

  it('failedHere rules only for the attempt whose ids survive', () => {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1');
    const fence = createTickerRefreshFence(opts);
    const a1 = fence.begin('u-1', 'unsubscribe', 'w-2');
    showErrorPage();
    expect(fence.failedHere(a1)).toBe(true);
    expect(fence.failedHere('not-an-attempt' as string)).toBe(false);
    expect(fence.failedHere(null)).toBe(false);
  });
});
