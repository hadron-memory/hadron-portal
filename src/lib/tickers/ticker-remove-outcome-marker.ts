/**
 * portal#1502 (Colette QA delta) — the stale-row refusal's sentence must
 * survive kit's DOCUMENT FALLBACK. A refused removal's reload does not reject
 * in a real kit: an aborted data refresh makes the router fall back to a full
 * document navigation, which tears down the panel, the page's outcome region
 * and the settle continuation with it. The freshly loaded page would show
 * nothing — the sentence reaches the reader only through this marker, left
 * just before the reload and taken once by the ticker page when a fallback (or
 * any later visit inside the window) lands it there.
 *
 * The #1462 / refresh-marker disciplines ($lib/tickers/ticker-refresh-marker),
 * under its OWN key so the two claims can never decorate each other: scoped to
 * the viewer, the canonical App and ticker (both required — the marker fails
 * closed without them), the ticker's route spelling at write time (the fresh
 * page knows only its URL), and the removal's own subscription; one attempt;
 * bounded in time; taken once; every access guarded, so blocked or full
 * storage changes nothing about the action — only whether the sentence
 * survives the reload.
 *
 * One discipline deliberately DIVERGES from the sibling markers: no
 * same-document module-state guard on the take. Their consumer (a kit error
 * boundary) lives in the same document as the writer, so an attempt the module
 * does not know as its latest is foreign there. THIS marker's consumer is a
 * FRESH document — the module state is gone by construction — so the scope
 * (viewer, App, ticker under either spelling, the removal's own subscription)
 * and the window are the whole fence.
 *
 * The SENTENCE is stored, where the refresh marker stores ids only: it is the
 * server's own copy for THIS viewer's refused write, consumed only in this
 * viewer's fresh render of the same ticker. On a completed fallback it is true
 * as written (the reader IS on the first page); the live page clears the
 * marker at settlement, so this sentence and the corrected failed-reload copy
 * ($lib/tickers/controls — noLongerSubscribedText) never both apply.
 */
const KEY = 'portal:ticker-actions:remove-outcome';
export const TICKER_REMOVE_OUTCOME_MARKER_KEY = KEY;
/** After this the marker says nothing: a later, unrelated visit must not inherit it. */
export const TICKER_REMOVE_OUTCOME_MARKER_WINDOW_MS = 2 * 60 * 1000;

export interface TickerRemoveOutcomeMarkerScope {
  viewer: string;
  /** The ticker's canonical App: required, the marker fails closed without it. */
  appId: string;
  /** The ticker's canonical id: required, the marker fails closed without it. */
  tickerId: string;
  /** The ROUTE's spelling of the ticker at the moment of the removal (id or URN), as the refresh marker stores it. */
  routeTickerId: string;
  /** The removal's own subscription — one removal's sentence may not claim another's. */
  subscriptionId: string;
  /** The server's own refusal sentence, shown verbatim after a fallback lands the reader on the first page. */
  sentence: string;
}

/** What the ticker page knows about itself when it takes the marker. */
export interface TickerRemoveOutcomeMarkerContext {
  viewer: string;
  appId: string;
  /** The ticker as the page's URL spells it — matched against both stored spellings. */
  tickerId: string;
}

/** What a taken marker hands the page: enough to render the outcome, nothing more. */
export interface TickerRemoveOutcomeMarkerClaim {
  subscriptionId: string;
  sentence: string;
}

interface Marker {
  v: 1;
  viewer: string;
  appId: string;
  tickerId: string;
  routeTickerId: string;
  subscriptionId: string;
  sentence: string;
  attempt: string;
  at: number;
}

let counter = 0;

const str = (v: unknown): v is string => typeof v === 'string' && v !== '';

function read(): Marker | null {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Partial<Marker> | null;
    if (
      m && m.v === 1 && str(m.viewer) && str(m.appId) && str(m.tickerId) && str(m.routeTickerId) &&
      str(m.subscriptionId) && str(m.sentence) && str(m.attempt) && typeof m.at === 'number'
    ) return m as Marker;
  } catch {
    // fall through: a corrupt value is removed by the caller
  }
  return null;
}

/** Leave the marker. Returns its attempt id, or null when it could not be written (the removal goes on without it). */
export function setTickerRemoveOutcomeMarker(scope: TickerRemoveOutcomeMarkerScope, now: number = Date.now()): string | null {
  if (
    !str(scope.viewer) || !str(scope.appId) || !str(scope.tickerId) || !str(scope.routeTickerId) ||
    !str(scope.subscriptionId) || !str(scope.sentence)
  ) return null;
  try {
    const attempt = `${now.toString(36)}-${(++counter).toString(36)}`;
    const marker: Marker = {
      v: 1,
      viewer: scope.viewer,
      appId: scope.appId,
      tickerId: scope.tickerId,
      routeTickerId: scope.routeTickerId,
      subscriptionId: scope.subscriptionId,
      sentence: scope.sentence,
      attempt,
      at: now,
    };
    sessionStorage.setItem(KEY, JSON.stringify(marker));
    return attempt;
  } catch {
    return null;
  }
}

/** Remove the marker: only the given attempt's when one is named, whatever is there otherwise. */
export function clearTickerRemoveOutcomeMarker(attempt?: string): void {
  try {
    if (attempt !== undefined && read()?.attempt !== attempt) return;
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear when storage is unavailable
  }
}

/**
 * The claim of THIS viewer, App and ticker inside its window, once — and the
 * marker is consumed. The ticker matches EITHER stored spelling, exactly as
 * the refresh marker does. A live marker for another App or ticker is left
 * alone (it says nothing here). Another viewer's, an expired, future-dated or
 * corrupt one is removed. A context with no ticker id cannot claim anything,
 * and removes nothing. No module-state guard, per the header: the claiming
 * page is a fresh document.
 */
export function takeTickerRemoveOutcomeMarker(ctx: TickerRemoveOutcomeMarkerContext, now: number = Date.now()): TickerRemoveOutcomeMarkerClaim | null {
  try {
    const m = read();
    if (!m) {
      if (sessionStorage.getItem(KEY) !== null) sessionStorage.removeItem(KEY);
      return null;
    }
    const age = now - m.at;
    if (!str(ctx.viewer) || m.viewer !== ctx.viewer || age < 0 || age > TICKER_REMOVE_OUTCOME_MARKER_WINDOW_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    if (!str(ctx.appId) || !str(ctx.tickerId) || ctx.appId !== m.appId || (ctx.tickerId !== m.tickerId && ctx.tickerId !== m.routeTickerId)) return null;
    sessionStorage.removeItem(KEY);
    return { subscriptionId: m.subscriptionId, sentence: m.sentence };
  } catch {
    return null;
  }
}
