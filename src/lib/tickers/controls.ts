import { t } from '$lib/i18n/t';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import type { TickerRosterRead } from '$lib/tickers/types';

/**
 * portal#1497 (MCP cut R7a) — the ticker page's control actions: what their
 * results look like on the client, and the fixed copy each state shows. The
 * action's shape is the contract (`{action, ok, target}` or a refusal): a
 * result names WHAT it was about, so it attaches only to the form that ran it
 * and survives the page reload that follows a committed write.
 */

export type TickerControlActionName = 'set-enabled' | 'subscribe' | 'unsubscribe';

/** What a successful control action returned, with only the fields the page renders. */
export interface TickerControlSuccess {
  action: TickerControlActionName;
  ok: true;
  target: string | { tickerId: string };
  enabled?: boolean;
  announcementFailed?: true;
}

/** A success as the action wrote it, or null: anything else is not a success. */
export function asTickerSuccess(data: unknown): TickerControlSuccess | null {
  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) return null;
  const d = data as Partial<TickerControlSuccess>;
  if (d.action !== 'set-enabled' && d.action !== 'subscribe' && d.action !== 'unsubscribe') return null;
  return { action: d.action, ok: true, target: d.target ?? '', enabled: d.enabled, announcementFailed: d.announcementFailed === true ? true : undefined };
}

/** A refusal as `writeFailure` wrote it (typed or uncertain); anything else is the fixed uncertain line. */
export function asTickerRefusal(data: unknown): WriteRefusal {
  const r = data && typeof data === 'object' && 'refusal' in data ? (data as { refusal?: unknown }).refusal : null;
  if (r && typeof r === 'object' && 'kind' in r) {
    const kind = (r as { kind: unknown }).kind;
    if (kind === 'refused' || kind === 'uncertain' || kind === 'invalid') return r as WriteRefusal;
  }
  return { kind: 'uncertain' };
}

/** The subscriber list's first page: add/remove reload from the top, so `?after=` is dropped. */
export const tickerFirstPageHref = (appId: string, tickerId: string) => `/app/apps/${appId}/tickers/${tickerId}`;

/**
 * What a finished removal reports to the PAGE (portal#1502 delta seats): the
 * reload a committed removal (or the stale-row SUBSCRIPTION_NOT_FOUND refusal)
 * triggers drops the row, the row is what keeps the Remove panel mounted, so
 * the result must outlive the panel — it is handed up as it happens, and the
 * page owns where it renders. Only outcomes the panel will not itself keep
 * showing are reported: a committed own-row removal and the stale-row refusal.
 */
export interface TickerRemoveOutcome {
  /**
   * The ticker the removal happened on. Kit REUSES the page component for the
   * next ticker under this route, so the page fences every outcome by entity:
   * a removal of ticker A may claim nothing on ticker B (portal#1502 BLIND
   * delta, Gaby P2 — the same fence
   * hrn:node:hadronmemory.com:hadron-portal:review:superforms-late-result-crosses-entity-navigation
   * demands of a superForm on a reused [id] page).
   */
  tickerId: string;
  /**
   * The row's own subscription. The page checks every arriving outcome against
   * the row whose Remove it opened, so a late result of another row attaches
   * to nothing by the page's own guard (portal#1502 delta, Gemma P3-a).
   */
  subscriptionId: string;
  /** The sentence to show, already resolved ('Removed <worker>', or the stale-row refusal's own). */
  text: string;
  /**
   * The removed worker's URN, for the chip beside the sentence — once the row
   * is gone, the outcome is the only line that names whom, and a name alone is
   * not addressable (portal#1502, Uma P3-1 / Gaby P3-2, per
   * hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
   * Null when the outcome carries no worker of its own: the stale-row refusal
   * shows the server's sentence unchanged.
   */
  workerUrn: string | null;
  announcementFailed: boolean;
  refreshFailed: TickerRemoveRefreshFailed;
}

/**
 * Which kind of reload failed, and therefore which claim its caveat may make
 * (portal#1502 BLIND delta, Gizelle P2-2). `false`: the reload was healthy.
 * `'committed'`: a COMMITTED removal's reload failed — the write stands, so
 * "Saved; the page couldn't reload." is true. `'refused'`: a refused
 * (never-written) removal's reload failed — no save happened, so its caveat
 * may say only that the page couldn't reload, never "Saved".
 */
export type TickerRemoveRefreshFailed = false | 'committed' | 'refused';

export const tickerRefreshFailedLine = () => t('app.ticker.controls.refresh-failed', 'Saved; the page couldn’t reload.');

/**
 * portal#1502 BLIND delta (Gizelle P2-2): the caveat for a REFUSED removal
 * whose reload failed. No write happened, so "Saved;" would claim a save the
 * server refused — the line names only the reload.
 */
export const tickerReloadFailedNoSaveLine = () => t('app.ticker.controls.reload-failed-no-save', 'The page couldn’t reload.');

/**
 * The caveat for a removal's failed reload, stating only what is true of its
 * KIND (Gizelle P2-2). The one picker every rendering surface uses, beside
 * the type it picks by — a second copy of the ternary anywhere is how the
 * refused case drifts back to claiming a save.
 */
export const tickerReloadFailedLine = (kind: 'committed' | 'refused') =>
  kind === 'refused' ? tickerReloadFailedNoSaveLine() : tickerRefreshFailedLine();

/**
 * hrn:node:hadronmemory.com:specs:cor:agt:080:20 as the portal states it, beside the subscriber controls AND as the SUBSCRIBE_FORBIDDEN
 * sentence — ONE copy (D4): the refusal copy in $lib/server/ticker-writes imports this, and the page
 * renders it next to Add/Remove, so they can never drift apart.
 */
export const tickerSubscribeWhoText = () =>
  t('app.ticker.controls.who-subscribe', 'Only a worker’s holder or whoever manages the App can subscribe or unsubscribe that worker.');

/** Neutral by requirement: `SubscribeResult` carries no created flag, so this submit is never said to have created the row. */
export const subscribedText = () => t('app.ticker.controls.subscribed', 'Subscribed');

/** The PANEL's own bare result — its confirmation names the worker right above it, so context supplies the subject. */
export const removedText = () => t('app.ticker.controls.removed', 'Removed');

/** Names the worker: the PAGE-level outcome is the only line left once the row is gone (portal#1502, Uma P3-1 / Gaby P3-2). */
export const removedWorkerText = (label: string) => t('app.ticker.controls.removed-worker', 'Removed {name}', { name: label });

/**
 * portal#1502 (Uma P2 / Gizelle BLIND delta): the base sentence for a
 * stale-row refusal whose reload FAILED. The server's own sentence says "the
 * list is back at its first page" — copy written for the reload that did not
 * happen. This line claims only the first truth; the reload caveat (kind
 * 'refused') carries the rest.
 */
export const noLongerSubscribedText = () => t('app.ticker.controls.remove.stale-no-reload', 'No longer subscribed.');

export const announcementFailedText = () =>
  t('app.ticker.controls.announcement-failed', 'The team-chat notice about this change didn’t go out. The change itself stands.');

/** The chooser's own states, each with its own text (never an empty list in disguise). */
export const rosterHiddenText = () => t('app.ticker.controls.roster-hidden', 'You can’t list this App’s workers here.');
export const rosterFailedText = () => t('app.ticker.controls.roster-failed', 'Couldn’t load the App’s workers.');
export const rosterEmptyText = () => t('app.ticker.controls.roster-empty', 'No workers to add.');

/** A roster worker's label: its name when it has one, else its URN or id — never dropped for lacking a name. */
export const rosterWorkerLabel = (w: { id: string; name: string | null; urn: string | null }): string =>
  w.name ?? w.urn ?? w.id;

export type { TickerRosterRead };
