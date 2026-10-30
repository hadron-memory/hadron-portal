import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type {
  AppTickerSettings,
  SubscriberPage,
  TickerDetail,
  TickerListRow,
  TickerRead,
  TickerTask,
  WorkerWakeSettings,
} from '$lib/tickers/types';

/**
 * portal#1099 — Tickers S7a: the views' reads, and ONLY reads (Holger via
 * Vera, team chat #11540: S7b's writes are not in v1). Every document here is
 * a query; there is no mutation in this module, and none may be added for S7a.
 *
 * Server gates, as built (Vera's spec check on #1099): tickers, a ticker's
 * subscribers and App ticker settings need participation in the App
 * (`resolveParticipatedApp`), and a reader outside it gets APP_NOT_FOUND;
 * wake settings answer WORKER_NOT_FOUND to the same reader; AppKey.scopes is
 * manager-only and refuses with FORBIDDEN. Only those codes map to a
 * concealment state (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only);
 * anything else is a failure, never an empty list.
 */

const TICKER_FIELDS = /* GraphQL */ `
  fragment TickerFields on Ticker {
    id name slug urn enabled cadenceSeconds anchorAt nextTickAt lastTickAt
    quietHours relevance reasons createdAt updatedAt
    channels { id name }
    owner { id name urn }
  }
`;

// The list's subscriber column counts one page. `subscribers` has no total, so
// a full page with hasNextPage reads "50+", never a guessed number.
export const SUBSCRIBER_COUNT_PAGE = 50;

export const APP_TICKERS_QUERY = /* GraphQL */ `
  ${TICKER_FIELDS}
  query AppTickers($appRef: String!, $first: Int) {
    tickers(appRef: $appRef) {
      ...TickerFields
      subscribers(first: $first) { hasNextPage items { id } }
    }
  }
`;

export const APP_TICKER_SETTINGS_QUERY = /* GraphQL */ `
  query AppTickerSettings($appRef: String!) {
    appTickerSettings(appRef: $appRef) {
      minCadenceSeconds selfSubscribeCadenceSeconds liveCap dailyWakeBudget dailyWakeBudgetDerived
    }
  }
`;

export const TICKER_QUERY = /* GraphQL */ `
  ${TICKER_FIELDS}
  query Ticker($ref: String!) {
    ticker(ref: $ref) {
      ...TickerFields
      tickCode
      app { id }
    }
  }
`;

// portal#1384 — its OWN request, never a field on TICKER_QUERY: registerTaskLoc runs a lookup on
// the server, and a field error inside TICKER_QUERY would turn the whole page into an error. Alone,
// a failure blanks only the Task entry.
export const TICKER_TASK_QUERY = /* GraphQL */ `
  query TickerTask($ref: String!) {
    ticker(ref: $ref) {
      id
      registerTaskLoc
    }
  }
`;

/** The detail page reads subscribers this many at a time; the server caps a page at 200. */
export const SUBSCRIBER_PAGE = 100;

export const TICKER_SUBSCRIBERS_QUERY = /* GraphQL */ `
  query TickerSubscribers($ref: String!, $first: Int, $after: String) {
    ticker(ref: $ref) {
      id
      subscribers(first: $first, after: $after) {
        hasNextPage endCursor
        items {
          id createdAt viaGrant
          createdBy { id name urn }
          worker { id name urn retiredAt }
        }
      }
    }
  }
`;

export const WORKER_WAKE_SETTINGS_QUERY = /* GraphQL */ `
  query WorkerWakeSettings($workerRef: String!) {
    workerWakeSettings(workerRef: $workerRef) {
      mentions pausedUntil dormant effectiveCadenceSeconds
      subscriptions {
        id createdAt viaGrant
        createdBy { id name urn }
        ticker { id name urn enabled cadenceSeconds quietHours }
      }
    }
  }
`;

// Its OWN request, never a field on the keys list: `scopes` is non-null and
// throws FORBIDDEN for anyone who doesn't manage the App, and a field error on
// a non-null list member nulls the whole list. Selected beside the keys, it
// would empty the App Keys tab for every non-manager.
export const APP_KEY_SCOPES_QUERY = /* GraphQL */ `
  query AppKeyScopes($appRef: ID!) {
    appKeys(appRef: $appRef) {
      id
      scopes { scope hostId grantedAt }
    }
  }
`;

function classify<T>(e: unknown, what: string, concealed: readonly string[]): TickerRead<T> {
  const code = extractGqlErrorCode(e);
  if (code !== null && concealed.includes(code)) return { kind: 'not-participant' };
  console.warn(`[tickers] ${what} failed:`, e);
  return { kind: 'failed' };
}

const APP_CONCEALED = ['APP_NOT_FOUND'] as const;

export async function loadTickers(client: GraphQLClient, appRef: string): Promise<TickerRead<TickerListRow[]>> {
  try {
    const r = await client.request<{ tickers: TickerListRow[] }>(APP_TICKERS_QUERY, { appRef, first: SUBSCRIBER_COUNT_PAGE });
    return { kind: 'ok', value: r.tickers };
  } catch (e) {
    return classify(e, `tickers read for ${appRef}`, APP_CONCEALED);
  }
}

export async function loadAppTickerSettings(client: GraphQLClient, appRef: string): Promise<TickerRead<AppTickerSettings>> {
  try {
    const r = await client.request<{ appTickerSettings: AppTickerSettings }>(APP_TICKER_SETTINGS_QUERY, { appRef });
    return { kind: 'ok', value: r.appTickerSettings };
  } catch (e) {
    return classify(e, `ticker settings read for ${appRef}`, APP_CONCEALED);
  }
}

/**
 * One ticker, or null when it doesn't exist or the reader can't reach it: the
 * server answers both with null (TICKER_NOT_FOUND is swallowed there), so a
 * foreign ticker and a missing one are indistinguishable by design. The
 * ticker's `app` is null under the same rule when the reader can't read the
 * App directly (#1209) — callers treat that as not-found, never dereference it.
 */
export async function loadTicker(client: GraphQLClient, ref: string): Promise<TickerDetail | null> {
  const r = await client.request<{ ticker: TickerDetail | null }>(TICKER_QUERY, { ref });
  return r.ticker;
}

/**
 * portal#1384 — the loc the team maps this ticker's code to. `ok` with a null value means the
 * ticker itself came back null (gone or concealed since the facts were read): that is NOT an
 * answer about the mapping, so the page renders nothing. `ok` with `registerTaskLoc: null` is the
 * server's "no entry you can read". A thrown error is `failed`, never null.
 */
export async function loadTickerTask(client: GraphQLClient, ref: string): Promise<TickerRead<TickerTask | null>> {
  try {
    const r = await client.request<{ ticker: TickerTask | null }>(TICKER_TASK_QUERY, { ref });
    return { kind: 'ok', value: r.ticker ? { registerTaskLoc: r.ticker.registerTaskLoc } : null };
  } catch (e) {
    return classify(e, `task read for ${ref}`, APP_CONCEALED);
  }
}

export async function loadSubscribers(
  client: GraphQLClient,
  ref: string,
  after: string | null,
): Promise<TickerRead<SubscriberPage | null>> {
  try {
    const r = await client.request<{ ticker: { subscribers: SubscriberPage } | null }>(TICKER_SUBSCRIBERS_QUERY, {
      ref,
      first: SUBSCRIBER_PAGE,
      after,
    });
    return { kind: 'ok', value: r.ticker?.subscribers ?? null };
  } catch (e) {
    return classify(e, `subscribers read for ${ref}`, APP_CONCEALED);
  }
}

export async function loadWakeSettings(client: GraphQLClient, workerRef: string): Promise<TickerRead<WorkerWakeSettings>> {
  try {
    const r = await client.request<{ workerWakeSettings: WorkerWakeSettings }>(WORKER_WAKE_SETTINGS_QUERY, { workerRef });
    return { kind: 'ok', value: r.workerWakeSettings };
  } catch (e) {
    return classify(e, `wake settings read for ${workerRef}`, ['WORKER_NOT_FOUND', 'APP_NOT_FOUND']);
  }
}

export type KeyScope = { scope: string; hostId: string | null; grantedAt: string };

/**
 * The App Keys tab's Scopes column. `hidden` is the server's FORBIDDEN for a
 * reader who doesn't manage the App (hrn:node:hadronmemory.com:specs:cor:aut:010:03): the column simply isn't
 * shown, which is what the field's own gate means, not an error.
 */
export type KeyScopesRead = { kind: 'ok'; byKey: Record<string, KeyScope[]> } | { kind: 'hidden' } | { kind: 'failed' };

export async function loadAppKeyScopes(client: GraphQLClient, appRef: string): Promise<KeyScopesRead> {
  try {
    const r = await client.request<{ appKeys: { id: string; scopes: KeyScope[] }[] }>(APP_KEY_SCOPES_QUERY, { appRef });
    return { kind: 'ok', byKey: Object.fromEntries(r.appKeys.map((k) => [k.id, k.scopes])) };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code === 'FORBIDDEN') return { kind: 'hidden' };
    console.warn(`[tickers] key scopes read for ${appRef} failed:`, e);
    return { kind: 'failed' };
  }
}
