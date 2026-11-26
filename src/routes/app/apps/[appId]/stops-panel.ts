/**
 * portal#1139 — the App's stop signals, as a section of Settings: the signals page, the live stops (for the
 * form's coverage text), the viewer's manage hint, the worker roster and the people who set stops.
 * Read only when the section is asked for (the URL names it, or the reader unfolds it).
 *
 * `App.viewerManages` is a display hint only: the server decides on every set and lift. A failed hint read is
 * `unknown`, never `no`. The reads classify their own failures (`not-participant`, `failed`), so a stop read
 * that answers a non-participant APP_NOT_FOUND is a state of the section and never the App page's 404.
 */
import type { GraphQLClient } from 'graphql-request';
import { loadLiveStops, loadManagesHint, loadStopPage, loadStopPeople, loadStopWorkers } from '$lib/server/stop-signals';

/** A stop-list cursor longer than this is not one of ours: ignored. */
const MAX_CURSOR = 512;

export async function loadStopsPanel(want: boolean, client: GraphQLClient, appId: string, locals: App.Locals, afterParam: string | null) {
  if (!want) return null;
  const after = afterParam && afterParam.length <= MAX_CURSOR ? afterParam : null;
  const [page, live, manages, roster, people] = await Promise.all([
    loadStopPage(client, appId, after),
    loadLiveStops(client, appId),
    loadManagesHint(client, appId),
    loadStopWorkers(client, appId),
    loadStopPeople(client, appId),
  ]);
  return {
    page,
    live,
    manages,
    workers: roster.workers,
    rosterFailed: roster.failed,
    people,
    after,
    loadedAt: new Date().toISOString(),
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
}
