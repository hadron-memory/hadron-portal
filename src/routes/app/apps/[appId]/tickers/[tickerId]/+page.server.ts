import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppTickerSettings, loadSubscribers, loadTicker, loadTickerTask } from '$lib/server/tickers';
import { formValues, impersonationRefusal, writeFailure } from '$lib/server/agent-task-writes';
import { DELETE_TICKER_MUTATION, UPDATE_TICKER_MUTATION, classifyTickerWriteError } from '$lib/server/ticker-writes';
import { buildUpdatePatch } from '$lib/tickers/write';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1099 — one ticker: its facts and its subscribers (design §3.2),
 * read-only. The App is read first and alone, as on the list. A ticker the
 * viewer can't reach, one that doesn't exist, and one whose App the viewer
 * can't read (ticker.app null, #1209) are all this page's 404; a ticker of
 * another App redirects to its canonical address, as runs/[runId] does.
 *
 * portal#1151 (S7b): Edit and Delete are this route's two actions. There is no
 * activation control and no subscriber write.
 *
 * portal#1384: the task the team maps this ticker to is its own read, so its
 * failure blanks only that entry. Subscribers page forward with `?after=`; the server gives no total.
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
  const [subscribers, settings, tickerTask] = await Promise.all([
    loadSubscribers(client, ticker.id, after),
    loadAppTickerSettings(client, app.id),
    loadTickerTask(client, ticker.id),
  ]);
  return {
    app,
    ticker,
    subscribers,
    settings,
    tickerTask,
    paged: after !== null,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

/*
 * No client-side "can this reader manage it" guess: the server has no
 * `canManage` for tickers, so every participant is offered the controls and the
 * server's refusal answers anyone who may not (hrn:node:hadronmemory.com:specs:cor:agt:080:18). A control left
 * over from before the ticker changed answers TICKER_NOT_FOUND or FORBIDDEN and
 * says so. An uncertain outcome is shown as such and never retried.
 */
export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('update', impersonationRefusal(), values);
    const built = buildUpdatePatch(fd);
    if ('invalid' in built) return writeFailure('update', { kind: 'invalid', ...built.invalid }, values);
    try {
      await gqlClient(locals.token).request(UPDATE_TICKER_MUTATION, { ref: params.tickerId, input: built.patch });
      return { action: 'update' as const, ok: true as const };
    } catch (e) {
      return writeFailure('update', classifyTickerWriteError(e, 'update'), values);
    }
  },

  delete: async ({ request, params, locals }) => {
    const values = formValues(await request.formData());
    if (locals.impersonation) return writeFailure('delete', impersonationRefusal(), values);
    try {
      const r = await gqlClient(locals.token).request<{ deleteTicker: boolean }>(DELETE_TICKER_MUTATION, { ref: params.tickerId });
      if (r.deleteTicker !== true) return writeFailure('delete', { kind: 'uncertain' }, values);
      return { action: 'delete' as const, ok: true as const };
    } catch (e) {
      return writeFailure('delete', classifyTickerWriteError(e, 'delete'), values);
    }
  },
};
