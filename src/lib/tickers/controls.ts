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
   * The row's own subscription. The page checks every arriving outcome against
   * the row whose Remove it opened, so a late result of another row attaches
   * to nothing by the page's own guard (portal#1502 delta, Gemma P3-a).
   */
  subscriptionId: string;
  /** The sentence to show, already resolved ('Removed', or the stale-row refusal's own). */
  text: string;
  announcementFailed: boolean;
  refreshFailed: boolean;
}

export const tickerRefreshFailedLine = () => t('app.ticker.controls.refresh-failed', 'Saved; the page couldn’t reload.');

/**
 * hrn:node:hadronmemory.com:specs:cor:agt:080:20 as the portal states it, beside the subscriber controls AND as the SUBSCRIBE_FORBIDDEN
 * sentence — ONE copy (D4): the refusal copy in $lib/server/ticker-writes imports this, and the page
 * renders it next to Add/Remove, so they can never drift apart.
 */
export const tickerSubscribeWhoText = () =>
  t('app.ticker.controls.who-subscribe', 'Only a worker’s holder or whoever manages the App can subscribe or unsubscribe that worker.');

/** Neutral by requirement: `SubscribeResult` carries no created flag, so this submit is never said to have created the row. */
export const subscribedText = () => t('app.ticker.controls.subscribed', 'Subscribed');

export const removedText = () => t('app.ticker.controls.removed', 'Removed');

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
