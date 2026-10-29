import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { formValues, impersonationRefusal, writeFailure } from '$lib/server/agent-task-writes';
import {
  SET_APP_DELIVERY_SETTINGS_MUTATION,
  buildDeliveryPatch,
  classifyDeliveryError,
  loadAppDeliverySettings,
} from '$lib/server/delivery-settings';
import { loadAppTickerSettings, loadTickers, SUBSCRIBER_COUNT_PAGE } from '$lib/server/tickers';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1099 — the App's Tickers sub-route (Tickers S7a, read-only; Holger
 * via Vera, team chat #11540). Its own route, like Runs, Channels and Tasks,
 * so a ticker read that answers a non-participant APP_NOT_FOUND never reaches
 * the App page's loader
 * (hrn:node:hadronmemory.com:hadron-portal:designs:tickers-and-wake §2).
 *
 * The ticker settings stay read-only (S7b's writes are not in v1). The one
 * write here is the `delivery` action (portal#1141 slice A, hadron-server S9),
 * which sends only the delivery fields the reader changed; a test pins that
 * this is the only action.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  // The App's header first and alone: one the viewer can't see is the App
  // page's 404, and only a refusal is (portal#1130's shared salvage).
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const [tickers, settings, delivery] = await Promise.all([
    loadTickers(client, app.id),
    loadAppTickerSettings(client, app.id),
    loadAppDeliverySettings(client, app.id),
  ]);
  return {
    app,
    tickers,
    settings,
    delivery,
    subscriberCountPage: SUBSCRIBER_COUNT_PAGE,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

/*
 * No manage audit here (Rodolfo's §10 P2 on #1152): `effectiveAccess.canManage`
 * under-reports owner-role members whom the server's managesApp admits, so a
 * negative answer is no basis for hiding the form. Every participant whose
 * read succeeded is offered it, and the server's FORBIDDEN sentence answers
 * anyone who may not. A viewer fact from the server (hadron-server#2109) can
 * replace this when it exists.
 */

export const actions: Actions = {
  delivery: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('delivery', impersonationRefusal(), values);
    const built = buildDeliveryPatch(fd);
    if ('invalid' in built) return writeFailure('delivery', { kind: 'invalid', ...built.invalid }, values);
    try {
      await gqlClient(locals.token).request(SET_APP_DELIVERY_SETTINGS_MUTATION, { appRef: params.appId, input: built.patch });
      return { action: 'delivery' as const, ok: true as const };
    } catch (e) {
      return writeFailure('delivery', classifyDeliveryError(e), values);
    }
  },
};
