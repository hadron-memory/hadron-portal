/**
 * portal#1502 (Colette QA delta) — the stale-row refusal's outcome marker:
 * the SENTENCE of a refused removal, left just before its reload and taken
 * once by the ticker page a document FALLBACK lands on (an aborted data
 * refresh does not reject in a real kit — it tears the whole client document
 * down and loads the route fresh, so the sentence reaches that page only
 * through sessionStorage).
 *
 * That consumer is a FRESH document, so the #1462/#1497 markers' same-document
 * module-state guard is impossible here BY DESIGN: the claim below must work
 * when the taking module instance never wrote the marker. The scope (viewer,
 * canonical App, ticker under either spelling, the removal's own subscription)
 * and the window are the whole fence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTickerRemoveOutcomeMarker,
  setTickerRemoveOutcomeMarker,
  takeTickerRemoveOutcomeMarker,
  TICKER_REMOVE_OUTCOME_MARKER_KEY,
  TICKER_REMOVE_OUTCOME_MARKER_WINDOW_MS,
} from './ticker-remove-outcome-marker';
import { setTickerRefreshMarker, takeTickerRefreshMarker, TICKER_REFRESH_MARKER_KEY } from './ticker-refresh-marker';

afterEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

const SCOPE = {
  viewer: 'u1',
  appId: 'app-1',
  tickerId: 'tk-1',
  routeTickerId: 'tk-1',
  subscriptionId: 's-17',
  sentence: 'No longer subscribed. The list is back at its first page.',
};
const AT = Date.UTC(2026, 9, 31, 13, 0, 0);

describe('portal#1502 — the refused removal’s outcome marker', () => {
  it('claims once, for its own viewer, App and ticker, inside the window', () => {
    expect(setTickerRemoveOutcomeMarker(SCOPE, AT)).not.toBeNull();
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000))
      .toEqual({ subscriptionId: 's-17', sentence: SCOPE.sentence });
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1001)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('THE FALLBACK CASE: a fresh document (a module instance that never wrote it) still claims it', async () => {
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    // The document fallback: the old document (and its module state) is gone;
    // the page that lands on the first page imports this module FRESH.
    vi.resetModules();
    const fresh = await import('./ticker-remove-outcome-marker');
    expect(fresh.takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000))
      .toEqual({ subscriptionId: 's-17', sentence: SCOPE.sentence });
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('a marker of another App or another ticker says nothing here (and is left for its own page)', () => {
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-2', tickerId: 'tk-1' }, AT + 1000)).toBeNull();
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-9' }, AT + 1000)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).not.toBeNull();
  });

  it('a URN-spelled route still claims its marker: EITHER stored spelling matches (#1462 rule)', () => {
    setTickerRemoveOutcomeMarker({ ...SCOPE, routeTickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT + 1000)).not.toBeNull();
    sessionStorage.clear();

    setTickerRemoveOutcomeMarker({ ...SCOPE, routeTickerId: 'hrn:ticker:hadronmemory.com:team:eng' }, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).not.toBeNull();
  });

  it('a marker of another viewer is refused and removed (a later login may not inherit it)', () => {
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u2', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('expires after the window; a future-dated one is refused and removed', () => {
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + TICKER_REMOVE_OUTCOME_MARKER_WINDOW_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT - 1)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('fails closed: no viewer, App, ticker, route spelling, subscription or sentence, no marker is written', () => {
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, viewer: '' }, AT)).toBeNull();
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, appId: '' }, AT)).toBeNull();
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, tickerId: '' }, AT)).toBeNull();
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, routeTickerId: '' }, AT)).toBeNull();
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, subscriptionId: '' }, AT)).toBeNull();
    expect(setTickerRemoveOutcomeMarker({ ...SCOPE, sentence: '' }, AT)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('holds ids and the sentence only — never a worker name or Urn it did not earn', () => {
    setTickerRemoveOutcomeMarker(SCOPE, AT);
    const raw = sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY) ?? '';
    expect(raw).toContain('s-17');
    expect(raw).toContain(SCOPE.sentence);
    expect(raw).not.toContain('Liam');
    expect(raw).not.toContain('hrn:worker');
  });

  it('a corrupt value says nothing and is removed', () => {
    sessionStorage.setItem(TICKER_REMOVE_OUTCOME_MARKER_KEY, '{not json');
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('the refresh marker (#1497) and this marker never decorate each other', () => {
    setTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1', routeTickerId: 'tk-1', action: 'unsubscribe', targetWorkerId: 'w-2' }, AT);
    expect(takeTickerRemoveOutcomeMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBeNull();
    sessionStorage.clear();

    setTickerRemoveOutcomeMarker(SCOPE, AT);
    expect(takeTickerRefreshMarker({ viewer: 'u1', appId: 'app-1', tickerId: 'tk-1' }, AT + 1000)).toBe(false);
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('clearTickerRemoveOutcomeMarker removes only its own attempt’s marker', () => {
    const attempt = setTickerRemoveOutcomeMarker(SCOPE, AT);
    setTickerRemoveOutcomeMarker({ ...SCOPE, subscriptionId: 's-18', sentence: 'Other.' }, AT + 500);
    clearTickerRemoveOutcomeMarker(attempt!); // the first attempt is not the live one: nothing removed
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).not.toBeNull();
    clearTickerRemoveOutcomeMarker(); // whatever is there
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });
});
