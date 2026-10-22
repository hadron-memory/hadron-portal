import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppTickerSettings, loadSubscribers, loadTicker } from '$lib/server/tickers';
import type { PageServerLoad } from './$types';

/**
 * portal#1099 — one ticker: its facts and its subscribers (design §3.2),
 * read-only. The App is read first and alone, as on the list. A ticker the
 * viewer can't reach, one that doesn't exist, and one whose App the viewer
 * can't read (ticker.app null, #1209) are all this page's 404; a ticker of
 * another App redirects to its canonical address, as runs/[runId] does.
 *
 * Subscribers page forward with `?after=`; the server gives no total.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const ticker = await loadTicker(client, params.tickerId);
  if (!ticker?.app) throw error(404, 'Ticker not found');
  if (ticker.app.id !== app.id) {
    throw redirect(307, `/app/apps/${ticker.app.id}/tickers/${ticker.id}${url.search}`);
  }

  const after = url.searchParams.get('after');
  const [subscribers, settings] = await Promise.all([
    loadSubscribers(client, ticker.id, after),
    loadAppTickerSettings(client, app.id),
  ]);
  return {
    app,
    ticker,
    subscribers,
    settings,
    paged: after !== null,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};
