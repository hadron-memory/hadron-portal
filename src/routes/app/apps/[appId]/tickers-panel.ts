/**
 * portal#1099 — the App's tickers, as a section of Settings: the list, the ticker settings and the delivery settings.
 * Read only when the section is asked for (the URL names it, or the reader unfolds it).
 *
 * The three reads classify their own failures (`not-participant`, `failed`), so a ticker read that answers a
 * non-participant APP_NOT_FOUND is a state of the section and never reaches the App page's own 404
 * (hrn:node:hadronmemory.com:hadron-portal:designs:tickers-and-wake §2). The App read itself gates every tab.
 */
import type { GraphQLClient } from 'graphql-request';
import { loadAppDeliverySettings } from '$lib/server/delivery-settings';
import { loadAppTickerSettings, loadTickers, SUBSCRIBER_COUNT_PAGE } from '$lib/server/tickers';

export async function loadTickersPanel(want: boolean, client: GraphQLClient, appId: string, locals: App.Locals) {
  if (!want) return null;
  const [tickers, settings, delivery] = await Promise.all([
    loadTickers(client, appId),
    loadAppTickerSettings(client, appId),
    loadAppDeliverySettings(client, appId),
  ]);
  return {
    tickers,
    settings,
    delivery,
    subscriberCountPage: SUBSCRIBER_COUNT_PAGE,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
}
