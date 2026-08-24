import { error } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { TEAM_WORK_ITEMS_QUERY, WORKER_QUERY, WORKER_SESSIONS_QUERY } from '$lib/server/queries';
import type { TeamWorkItem, Worker, WorkerSession } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * #758 — the worker page's tab ids. These are ADDRESSES, not labels: they are
 * the `?tab=` values a shared link carries, and #761 made those survive the
 * `/app/u/<worker-urn>` resolver, which is the link every worker signs its
 * outward-facing work with. Rename a label freely; never rename one of these
 * (review:label-rename-is-not-an-id-rename).
 *
 * Validated in the LOADER rather than the component, mirroring the App page, so
 * URL parsing lives in one place and an unknown value falls back to the default
 * instead of rendering a page where no panel matches.
 */
const WORKER_TAB_IDS: readonly string[] = ['profile', 'sessions', 'worklog'];

/** Worker sessions shown before "…and N more". */
const SESSION_PAGE_SIZE = 20;
/** Worklog rows fetched; `total` tells the reader how many exist beyond them. */
const WORKLOG_PAGE_SIZE = 50;

/**
 * The worker page (#735) — the canonical destination for a `hrn:worker:` URN.
 *
 * It exists because hadron-server#1008 has every worker sign outward-facing
 * artifacts with a clickable URN so a reader "can see who you are rather than
 * guessing whether a human wrote it". That reader is arriving from a GitHub
 * issue asking *who is this*, and until now they landed on a 404 — the portal
 * resolved no `worker` kind even though the server has since #991.
 *
 * Deliberately a page rather than a redirect to the App's Staff tab: a roster
 * answers "which team", not "who is this". #737 grows this page with the
 * worker's sessions and worklog, which is the other half of that question.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const rawTab = url.searchParams.get('tab');
  const initialTab = WORKER_TAB_IDS.includes(rawTab ?? '') ? rawTab : null;
  let worker: Worker | null;
  try {
    ({ worker } = await gqlClient(locals.token).request<{ worker: Worker | null }>(WORKER_QUERY, {
      ref: params.id,
    }));
  } catch (err) {
    // The worker read is gated server-side (`requireWorkerReadAccess`), and for
    // the NAME form a denial is deliberately reported as WORKER_NOT_FOUND so
    // the roster is not an existence oracle. Mirror that here: a refusal and a
    // miss both surface as the same 404, and only KNOWN codes are mapped —
    // anything else rethrows so an outage stays a distinguishable 500
    // (review:clienterror-map-known-codes-only, review:no-silent-loader-catch).
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = (err.response.errors[0].extensions as { code?: string } | undefined)?.code;
      if (code === 'WORKER_NOT_FOUND' || code === 'NOT_FOUND' || code === 'FORBIDDEN') {
        throw error(404, 'No worker found here, or you do not have access to it.');
      }
    }
    throw err;
  }

  if (!worker) {
    throw error(404, 'No worker found here, or you do not have access to it.');
  }

  // #737 — the two sections that answer "what have they actually done".
  //
  // Each fetch fails INDEPENDENTLY and reports null rather than []. The issue is
  // explicit about why: "a section the viewer cannot read should surface as
  // unavailable, not silently render as empty. An empty worklog and a hidden
  // worklog must not look the same." Collapsing a refusal or an outage into an
  // empty array is the portal telling the reader this worker has done nothing.
  //
  // They are also independent of each other and of the identity block above: a
  // worklog outage must not blank the sessions list, and neither may 404 a page
  // whose identity half loaded fine.
  const client = gqlClient(locals.token);
  const [sessions, worklog] = await Promise.all([
    client
      // limit+1: `sessions` has no `total`, so "is there more" is answered by
      // observing a short page, not by counting.
      .request<{ sessions: WorkerSession[] }>(WORKER_SESSIONS_QUERY, {
        workerRef: worker.id,
        limit: SESSION_PAGE_SIZE + 1,
      })
      .then((d) => d.sessions)
      .catch((e) => {
        console.warn(`[worker-page] worker-sessions fetch failed for ${params.id}:`, e);
        return null;
      }),
    // teamWorkItems REQUIRES an appRef, and `worker.app` runs its own read gate
    // and masks to null on deny (#552). So a masked App is not an outage and
    // not an empty worklog — it is a section we cannot even ask for, and it
    // reports as unavailable rather than as "no records".
    worker.app?.id
      ? client
          .request<{ teamWorkItems: { items: TeamWorkItem[]; total: number } }>(
            TEAM_WORK_ITEMS_QUERY,
            { appRef: worker.app.id, workerRef: worker.id, limit: WORKLOG_PAGE_SIZE },
          )
          .then((d) => d.teamWorkItems)
          .catch((e) => {
            console.warn(`[worker-page] worklog fetch failed for ${params.id}:`, e);
            return null;
          })
      : Promise.resolve(null),
  ]);

  const sessionsTruncated = !!sessions && sessions.length > SESSION_PAGE_SIZE;

  return {
    worker,
    initialTab,
    workerSessions: sessions ? sessions.slice(0, SESSION_PAGE_SIZE) : null,
    sessionsTruncated,
    worklog: worklog?.items ?? null,
    worklogTotal: worklog?.total ?? 0,
  };
};
