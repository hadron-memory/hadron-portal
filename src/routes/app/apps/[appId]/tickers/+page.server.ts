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
import { SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
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

  const [tickers, settings, delivery, canManage] = await Promise.all([
    loadTickers(client, app.id),
    loadAppTickerSettings(client, app.id),
    loadAppDeliverySettings(client, app.id),
    selfCanManage(client, locals.user?.id ?? null, app.urn),
  ]);
  return {
    app,
    tickers,
    settings,
    delivery,
    canManage,
    subscriberCountPage: SUBSCRIBER_COUNT_PAGE,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

/**
 * Whether the signed-in user manages the App, as a display hint only: the
 * server decides every write. A failed or impossible audit is `null`
 * (unknown), which still offers the form and shows the server's answer,
 * rather than hiding a control the caller may well be allowed.
 */
async function selfCanManage(client: ReturnType<typeof gqlClient>, userId: string | null, appUrn: string): Promise<boolean | null> {
  if (!userId) return null;
  try {
    const r = await client.request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource: appUrn });
    return r.effectiveAccess.canManage;
  } catch (e) {
    console.warn('[tickers] manage-access check failed:', e);
    return null;
  }
}

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
