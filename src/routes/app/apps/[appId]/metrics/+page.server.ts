import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadTeamMetrics, windowFromParams } from '$lib/server/team-metrics';
import type { TeamMetricsView } from '$lib/team-metrics/types';
import type { PageServerLoad } from './$types';
/** Isolated from the shared App loader: a refused metrics read never blanks the App page (portal#1856). */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const w = windowFromParams(url.searchParams);
  // A malformed day is refused here, never guessed at and never sent to the server.
  let view: TeamMetricsView;
  if (w.malformed) {
    const base = await loadTeamMetrics(client, app.id);
    view = base.kind === 'ok' ? { kind: 'invalid', metrics: base.metrics } : base;
  } else view = await loadTeamMetrics(client, app.id, w);
  const read = <K extends 'since' | 'until'>(k: K) => (url.searchParams.get(k) ?? '');
  return { app, view, since: read('since'), until: read('until') };
};
