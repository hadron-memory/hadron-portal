/**
 * portal#1099 — the shapes the Tickers views read (Tickers S7a, read-only;
 * hrn:node:hadronmemory.com:hadron-portal:designs:tickers-and-wake).
 * Mirrors the server SDL selections in `$lib/server/tickers`.
 */

/** A ticker's owner, or a subscription's creator: a worker (with a URN) or a person (without one). */
export interface ActorRef {
  id: string;
  name: string;
  urn: string | null;
}

export interface TickerChannel {
  id: string;
  name: string;
}

/**
 * Why a ticker fires (server `TickerReason`, hrn:node:hadronmemory.com:specs:cor:agt:080:01). Closed
 * and any-of on the server, but typed open here: a value this build does not know renders as its raw
 * name instead of being dropped or turned into a known one.
 */
export type TickerReasonName = 'READ_TEAM_CHANNEL' | 'EVERY_TICK' | 'LIVE_CHECK';

export interface Ticker {
  id: string;
  name: string;
  slug: string;
  urn: string | null;
  enabled: boolean;
  cadenceSeconds: number;
  anchorAt: string;
  nextTickAt: string | null;
  lastTickAt: string | null;
  /** Raw JSON: `{ timezone, windows: [{ days, from, to }] }`, or null. Parse with `parseQuietHours`. */
  quietHours: unknown;
  relevance: 'ALL' | 'MENTIONS';
  /** Why it fires; any one is enough. Empty never fires (the server refuses to store it). */
  reasons: (TickerReasonName | (string & {}))[];
  /** Empty means every channel the subscriber watches. */
  channels: TickerChannel[];
  owner: ActorRef | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface TickerListRow extends Ticker {
  subscribers: { hasNextPage: boolean; items: { id: string }[] };
}

export interface SubscriptionWorker {
  id: string;
  name: string;
  urn: string | null;
  retiredAt: string | null;
}

export interface TickerSubscriber {
  id: string;
  createdAt: string;
  createdBy: ActorRef | null;
  viaGrant: boolean;
  worker: SubscriptionWorker;
}

export interface SubscriberPage {
  items: TickerSubscriber[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface AppTickerSettings {
  minCadenceSeconds: number;
  selfSubscribeCadenceSeconds: number;
  liveCap: number;
  dailyWakeBudget: number;
  dailyWakeBudgetDerived: boolean;
}

export interface WakeSubscription {
  id: string;
  createdAt: string;
  createdBy: ActorRef | null;
  viaGrant: boolean;
  ticker: Pick<Ticker, 'id' | 'name' | 'urn' | 'enabled' | 'cadenceSeconds' | 'quietHours'>;
}

export interface WorkerWakeSettings {
  mentions: string;
  pausedUntil: string | null;
  dormant: boolean;
  effectiveCadenceSeconds: number | null;
  subscriptions: WakeSubscription[];
}

/**
 * One read's outcome, so a view never confuses them
 * (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch):
 * `not-participant` is the server's concealment answer for a reader outside
 * the App (APP_NOT_FOUND, or WORKER_NOT_FOUND for a worker read); `failed` is
 * anything else, never rendered as an empty list.
 */
export type TickerRead<T> = { kind: 'ok'; value: T } | { kind: 'not-participant' } | { kind: 'failed' };
