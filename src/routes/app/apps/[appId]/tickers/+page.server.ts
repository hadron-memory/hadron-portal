import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { formValues, impersonationRefusal, taskWrite, writeFailure } from '$lib/server/agent-task-writes';
import {
  SET_APP_DELIVERY_SETTINGS_MUTATION,
  buildDeliveryPatch,
  classifyDeliveryError,
  loadAppDeliverySettings,
} from '$lib/server/delivery-settings';
import { CREATE_TICKER_MUTATION, classifyTickerWriteError } from '$lib/server/ticker-writes';
import { buildCreateInput } from '$lib/tickers/write';
import { loadAppTickerSettings, loadTickers, SUBSCRIBER_COUNT_PAGE } from '$lib/server/tickers';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1099 — the App's Tickers sub-route (Tickers S7a, read-only; Holger
 * via Vera, team chat #11540). Its own route, like Runs, Channels and Tasks,
 * so a ticker read that answers a non-participant APP_NOT_FOUND never reaches
 * the App page's loader
 * (hrn:node:hadronmemory.com:hadron-portal:designs:tickers-and-wake §2).
 *
 * The ticker settings stay read-only. The writes here are `delivery`
 * (portal#1141 slice A, hadron-server S9), which sends only the delivery fields
 * the reader changed, and `create` (portal#1151, S7b); a test pins the set.
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
  // portal#1151 (S7b): any participant may create, up to the cap; the server decides and its refusal renders.
  create: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('create', impersonationRefusal(), values);
    const built = buildCreateInput(fd);
    if ('invalid' in built) return writeFailure('create', { kind: 'invalid', ...built.invalid }, values);
    // portal#1384 (acceptance 9): createTicker may succeed WITH a warning (ticker.code.unmapped,
    // hadron-server#2733) in `extensions.warnings` under its own response key, which `request()`
    // drops. The create stays a success; the warning is shown as the server gave it.
    const out = await taskWrite<{ createTicker: { id: string; name: string } | null }>(
      gqlClient(locals.token),
      CREATE_TICKER_MUTATION,
      { appRef: params.appId, input: built.input },
      'createTicker',
      (e) => classifyTickerWriteError(e, 'create'),
    );
    if (out.kind === 'refused') return writeFailure('create', out.refusal, values);
    const made = out.data?.createTicker;
    const ticker = made && typeof made.id === 'string' && typeof made.name === 'string' ? { id: made.id, name: made.name } : null;
    // No usable ticker and no warning to prove the write landed: the outcome is unknown, never "created".
    if (!ticker && !out.committed) return writeFailure('create', { kind: 'uncertain' }, values);
    return {
      action: 'create' as const,
      ok: true as const,
      ticker,
      committedWithError: out.kind === 'committed-error',
      warnings: out.warnings,
      more: out.more,
    };
  },

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
