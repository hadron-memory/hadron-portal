import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppTickerSettings, loadSubscribers, loadTicker, loadTickerRoster, loadTickerTask } from '$lib/server/tickers';
import { formValues, impersonationRefusal, writeFailure } from '$lib/server/agent-task-writes';
import {
  DELETE_TICKER_MUTATION,
  SET_TICKER_ENABLED_MUTATION,
  SUBSCRIBE_WORKER_MUTATION,
  UNSUBSCRIBE_WORKER_MUTATION,
  UPDATE_TICKER_MUTATION,
  classifyTickerControlError,
  classifyTickerWriteError,
  tickerNotAvailableRefusal,
} from '$lib/server/ticker-writes';
import { buildUpdatePatch, enabledInvalidMessage, parseEnabledIntent, parseWorkerRef, workerInvalidMessage } from '$lib/tickers/write';
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
export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const ticker = await loadTicker(client, params.tickerId);
  if (!ticker?.app) throw error(404, 'Ticker not found');
  if (ticker.app.id !== app.id) {
    // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
    await parent();
    throw redirect(307, `/app/apps/${ticker.app.id}/tickers/${ticker.id}${url.search}`);
  }

  const after = url.searchParams.get('after');
  const [subscribers, settings, tickerTask] = await Promise.all([
    loadSubscribers(client, ticker.id, after),
    loadAppTickerSettings(client, app.id),
    loadTickerTask(client, ticker.id),
  ]);
  // portal#1497: ONE roster read per page load feeds the Add-subscriber
  // chooser (D5); its refusal/empty states are the chooser's, never an empty
  // list in disguise. The chooser is offered only to a participant, so the
  // read starts only when the subscribers read says this viewer is one —
  // serialized after it, the price of not billing every non-participant page
  // view a roster round-trip the server must refuse (#1497 review). The
  // synthesized 'hidden' is never rendered: the Add control sits behind the
  // same not-participant gate.
  const roster: Awaited<ReturnType<typeof loadTickerRoster>> =
    subscribers.kind === 'not-participant' ? { kind: 'hidden' } : await loadTickerRoster(client, app.id);
  return {
    app,
    ticker,
    subscribers,
    settings,
    tickerTask,
    roster,
    paged: after !== null,
    // portal#1497: the on/off action's URL keeps the page's own slice, so a
    // native POST reloads the view it came from.
    after,
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
 *
 * portal#1497 adds the activation and subscriber actions (`set-enabled`,
 * `subscribe`, `unsubscribe`) on the operations the disabled MCP tools used;
 * their refusals are fixed PORTAL copy (see $lib/server/ticker-writes), and
 * each one first re-checks the route-to-ticker App association above.
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

  /*
   * portal#1497 (MCP cut R7a): on/off, add subscriber, remove subscriber.
   * Before any mutation, each action re-reads the ticker's OWN App exactly the
   * way the loader does and compares it with the route App: a person in Apps A
   * and B must not be able to mutate B's ticker under A's path (the ref alone
   * does not carry the association). That is the necessary association check,
   * not a probe — it reads only what the viewer may read, refuses with the one
   * not-available sentence, and sends zero mutations on a mismatch. Everything
   * after it is the server's own authorization.
   */
  'set-enabled': async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('set-enabled', impersonationRefusal(), values);
    const enabled = parseEnabledIntent(fd);
    if (enabled === null) return writeFailure('set-enabled', { kind: 'invalid', field: 'enabled', message: enabledInvalidMessage() }, values);
    const client = gqlClient(locals.token);
    const guard = await tickerOfRouteApp(client, params.appId, params.tickerId);
    if (!guard) return writeFailure('set-enabled', tickerNotAvailableRefusal(), values);
    try {
      const r = await client.request<{ updateTicker: { id: string; enabled: boolean } }>(SET_TICKER_ENABLED_MUTATION, {
        // The guard's CANONICAL id, exactly as subscribe/unsubscribe key it: the
        // route param may be a URN or alias spelling, and updateTicker re-resolving
        // it could diverge from the association the guard just proved (#1497 review).
        ref: guard.tickerId,
        input: { enabled },
      });
      // The echo must equal the DESIRED value: a payload that doesn't is not a
      // success, and never a failure either — it is uncertain.
      if (r.updateTicker?.id !== guard.tickerId || r.updateTicker?.enabled !== enabled) {
        return writeFailure('set-enabled', { kind: 'uncertain' }, values);
      }
      return { action: 'set-enabled' as const, ok: true as const, target: { tickerId: guard.tickerId }, enabled };
    } catch (e) {
      return writeFailure('set-enabled', classifyTickerControlError(e, 'set-enabled'), values);
    }
  },

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('subscribe', impersonationRefusal(), values);
    const worker = parseWorkerRef(fd);
    if (worker === null) return writeFailure('subscribe', { kind: 'invalid', field: 'worker', message: workerInvalidMessage() }, values);
    const client = gqlClient(locals.token);
    const guard = await tickerOfRouteApp(client, params.appId, params.tickerId);
    if (!guard) return writeFailure('subscribe', tickerNotAvailableRefusal(), values);
    try {
      const r = await client.request<{ subscribeWorker: { announcement: string | null; subscription: { id: string; endedAt: string | null } } }>(
        SUBSCRIBE_WORKER_MUTATION,
        { tickerRef: guard.tickerId, workerRef: worker },
      );
      // A live subscription, and nothing less: SubscribeResult carries no
      // created flag, so idempotent and fresh are the same success.
      const sub = r.subscribeWorker?.subscription;
      if (!sub?.id || sub.endedAt !== null) return writeFailure('subscribe', { kind: 'uncertain' }, values);
      const out: { action: 'subscribe'; ok: true; target: string; announcementFailed?: true } = { action: 'subscribe', ok: true, target: worker };
      // 'FAILED' is the server's GrantAnnouncement enum value (#1747), not a
      // portal coinage — pinned against schema/schema.graphql in
      // src/lib/server/ticker-writes.test.ts (portal#1502 review).
      if (r.subscribeWorker?.announcement === 'FAILED') out.announcementFailed = true;
      return out;
    } catch (e) {
      return writeFailure('subscribe', classifyTickerControlError(e, 'subscribe'), values);
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('unsubscribe', impersonationRefusal(), values);
    const worker = parseWorkerRef(fd);
    if (worker === null) return writeFailure('unsubscribe', { kind: 'invalid', field: 'worker', message: workerInvalidMessage() }, values);
    const client = gqlClient(locals.token);
    const guard = await tickerOfRouteApp(client, params.appId, params.tickerId);
    if (!guard) return writeFailure('unsubscribe', tickerNotAvailableRefusal(), values);
    try {
      const r = await client.request<{ unsubscribeWorker: { announcement: string | null; subscription: { id: string; endedAt: string | null } } }>(
        UNSUBSCRIBE_WORKER_MUTATION,
        { tickerRef: guard.tickerId, workerRef: worker },
      );
      // The subscription must have ended; anything else is uncertain, never "failed".
      const sub = r.unsubscribeWorker?.subscription;
      if (!sub?.id || sub.endedAt === null) return writeFailure('unsubscribe', { kind: 'uncertain' }, values);
      const out: { action: 'unsubscribe'; ok: true; target: string; announcementFailed?: true } = { action: 'unsubscribe', ok: true, target: worker };
      // Same GrantAnnouncement enum value as subscribe, same pin.
      if (r.unsubscribeWorker?.announcement === 'FAILED') out.announcementFailed = true;
      return out;
    } catch (e) {
      return writeFailure('unsubscribe', classifyTickerControlError(e, 'unsubscribe'), values);
    }
  },
};

/**
 * portal#1497 — the route-to-ticker App check, before any mutation. Reads the
 * App and then the ticker's own App exactly as the loader does; a null ticker,
 * a ticker whose App the viewer cannot read, or a ticker of a different App
 * answers null (the caller refuses with the one sentence and writes nothing).
 * The returned ticker id is the canonical one the mutation is keyed by.
 */
async function tickerOfRouteApp(client: ReturnType<typeof gqlClient>, appId: string, tickerRef: string): Promise<{ tickerId: string } | null> {
  const app = await loadTasksApp(client, appId);
  if (!app) return null;
  const ticker = await loadTicker(client, tickerRef);
  if (!ticker?.app || ticker.app.id !== app.id) return null;
  return { tickerId: ticker.id };
}
