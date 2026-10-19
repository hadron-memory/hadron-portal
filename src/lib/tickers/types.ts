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

/**
 * portal#1141 slice A — the App's delivery settings (hadron-server S9,
 * `appDeliverySettings`). `standbyEnabled` is the stored switch and
 * `standbyEffective` is the server's word on whether it does anything; the
 * portal shows both as read and never sends the switch.
 */
export interface AppDeliverySettings {
  batchWindowSeconds: number;
  busyDelaySeconds: number;
  stuckWindowSeconds: number;
  standbyEnabled: boolean;
  standbyEffective: boolean;
}
