import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppTickerSettings, loadTickers, SUBSCRIBER_COUNT_PAGE } from '$lib/server/tickers';
import type { PageServerLoad } from './$types';

/**
 * portal#1099 — the App's Tickers sub-route (Tickers S7a, read-only; Holger
 * via Vera, team chat #11540). Its own route, like Runs, Channels and Tasks,
 * so a ticker read that answers a non-participant APP_NOT_FOUND never reaches
 * the App page's loader
 * (hrn:node:hadronmemory.com:hadron-portal:designs:tickers-and-wake §2).
 *
 * No `actions` export: S7b's writes are not in v1, and a test pins that.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  // The App's header first and alone: one the viewer can't see is the App
  // page's 404, and only a refusal is (portal#1130's shared salvage).
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const [tickers, settings] = await Promise.all([loadTickers(client, app.id), loadAppTickerSettings(client, app.id)]);
  return {
    app,
    tickers,
    settings,
    subscriberCountPage: SUBSCRIBER_COUNT_PAGE,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};
