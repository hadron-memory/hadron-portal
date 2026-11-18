import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { formValues, impersonationRefusal, writeFailure } from '$lib/server/agent-task-writes';
import {
  LIFT_TEAM_STOP_SIGNAL_MUTATION,
  SET_TEAM_STOP_SIGNAL_MUTATION,
  buildSetInput,
  classifyStopError,
  loadLiveStops,
  loadManagesHint,
  loadStopPage,
  loadStopPeople,
  loadStopWorkers,
} from '$lib/server/stop-signals';
import type { StopSignal } from '$lib/stop-signals/types';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1139 — the App's stop signals (hadron-server S6, wire #2166). Its own
 * sub-route, like Tickers and Tasks, so a stop read that answers a
 * non-participant APP_NOT_FOUND never reaches the App page's loader.
 *
 * `App.viewerManages` is a display hint only: the server decides on every set
 * and lift. A failed hint read is `unknown`, never `no`. Host scope is
 * display-only: the portal never sends it.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const after = url.searchParams.get('after');
  const [page, live, manages, roster, people] = await Promise.all([
    loadStopPage(client, app.id, after && after.length <= 512 ? after : null),
    loadLiveStops(client, app.id),
    loadManagesHint(client, app.id),
    loadStopWorkers(client, app.id),
    loadStopPeople(client, app.id),
  ]);
  return {
    app,
    page,
    live,
    manages,
    workers: roster.workers,
    rosterFailed: roster.failed,
    people,
    after: after && after.length <= 512 ? after : null,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};

export const actions: Actions = {
  set: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('set', impersonationRefusal(), values);
    const built = buildSetInput(fd, params.appId);
    if ('invalid' in built) return writeFailure('set', { kind: 'invalid', ...built.invalid }, values);
    try {
      const r = await gqlClient(locals.token).request<{ setTeamStopSignal: StopSignal }>(SET_TEAM_STOP_SIGNAL_MUTATION, { input: built.input });
      return { action: 'set' as const, ok: true as const, signalId: r.setTeamStopSignal.id };
    } catch (e) {
      return writeFailure('set', classifyStopError(e), values);
    }
  },

  lift: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('lift', impersonationRefusal(), values);
    const id = String(fd.get('id') ?? '').trim();
    if (!id) return writeFailure('lift', { kind: 'invalid', field: 'form', message: 'Choose a stop to lift.' }, values);
    try {
      const r = await gqlClient(locals.token).request<{ liftTeamStopSignal: { changed: boolean } }>(LIFT_TEAM_STOP_SIGNAL_MUTATION, {
        appRef: params.appId,
        id,
      });
      return { action: 'lift' as const, ok: true as const, id, changed: r.liftTeamStopSignal.changed };
    } catch (e) {
      return writeFailure('lift', classifyStopError(e), values);
    }
  },
};
