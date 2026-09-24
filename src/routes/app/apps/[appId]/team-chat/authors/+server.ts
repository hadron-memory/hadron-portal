// #855 (@codex on #908): the App's worker roster as { id, urn } pairs, for the
// team chat's author chips.
//
// The page renders chips from the roster it loaded with the page. A worker
// cast AFTER that load posts, its message arrives through the transcript poll,
// and the page's roster has never heard of it — so the chip would be missing
// until a full reload. The page asks here only then: when a polled message
// carries a worker id its roster does not contain. Not on every tick.
//
// Its own route rather than a mode of `../+server.ts`: that one answers "give
// me a window of this thread"; this answers "who are the workers". Same
// degrade-with-200 contract, for the same reason — it feeds a background
// refresh, and a failure must cost the chips, never the page.
//
// Access control is the GraphQL query's (`workers(appRef:)`), with the caller's
// own token, exactly as for the page load. No portal-side gate is re-implemented.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { WORKERS_QUERY } from '$lib/server/queries';
import type { Worker } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  try {
    const workers = await fetchAllItems<Worker>(gqlClient(locals.token), WORKERS_QUERY, 'workers', {
      appRef: params.appId,
      // Retired included, as on the page: a retired worker's old messages are
      // still in the thread, and its URN is permanent.
      includeRetired: true,
    });
    // Every rostered id, URN or not: a worker whose URN is null by contract is
    // KNOWN — asking again would not produce one — while an absent id is new.
    return json({ workers: workers.map((w) => ({ id: w.id, urn: w.urn ?? null })), loadFailed: false });
  } catch (e) {
    console.warn(`[team-chat] author roster read failed for ${params.appId}:`, e);
    return json({ workers: [], loadFailed: true }, { status: 200 });
  }
};
