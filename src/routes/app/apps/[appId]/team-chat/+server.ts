// The App team chat's transcript, as an isolated read for the poll (#785).
//
// #754 gave the thread an 8s poll wired as `invalidate(TEAM_CHAT_DEP)` against
// this route's own `+page.server.ts`. That worked, and it gave the poll a
// property nobody chose: the page load is a six-query parallel fetch whose
// failure paths are FATAL — `.catch(() => ({ organization: null }))` followed by
// `throw error(404)`, and transport failures on `APP_QUERY` surfacing as 500s.
// A transient blip on an unrelated query, during a background tick the reader
// never asked for, would replace their working page with an error page.
//
// Polling makes every fatal path in a large loader reachable on a timer. Before
// the poll, those were only reachable on navigation, where a failure is legible
// because the user just asked for something.
//
// So the tick reads HERE instead: one query, and a failure that degrades to
// "the thread did not update this time" rather than destroying the page. The
// convention (and the `loadFailed`-with-200 shape) is
// `memories/[id]/usage/activity/+server.ts`.
//
// Access control is the GraphQL query's, exactly as it is for the page load —
// `teamChatMessages(appRef:)` is App-membership gated server-side, and this
// handler passes the caller's own token. There is deliberately no portal-side
// gate re-implemented here: a second copy of an authorization rule is the drift
// this repo keeps filing issues about, and the weaker copy always wins.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTeamChatOlder, loadTeamChatTail } from '$lib/server/team-chat';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  // #793: one endpoint, two reads. `?beforeSeq=` asks for the page preceding a
  // cursor (scroll-up); its absence asks for the tail (the poll, and the first
  // paint). Kept on this route rather than a sibling because both are the same
  // question — "give me a window of this thread" — and a second route would be
  // a second place to keep the degrade-with-200 contract below in step.
  const beforeSeqRaw = url.searchParams.get('beforeSeq');
  const beforeSeq = beforeSeqRaw === null ? null : Number(beforeSeqRaw);
  // A malformed cursor is a client bug, not an empty thread. Refusing beats
  // silently falling back to the tail, which would re-serve the page the reader
  // already has and read to the component as "no more history".
  if (beforeSeqRaw !== null && (!Number.isFinite(beforeSeq) || beforeSeq! <= 0)) {
    return json({ items: [], total: 0, loadFailed: true, reason: 'bad-cursor' }, { status: 400 });
  }

  try {
    // The SAME helper the page load uses, not a second copy. It pages twice on
    // purpose — `teamChatMessages` is seq-ASCENDING with an offset cursor, so a
    // single `limit: 200` returns the OLDEST 200 and pins a long thread to the
    // start of history (Codex on #738). A re-implementation here would drift
    // from that rule the first time either side changed.
    const client = gqlClient(locals.token);
    const { items, total } =
      beforeSeq === null
        ? await loadTeamChatTail(client, params.appId)
        : await loadTeamChatOlder(client, params.appId, beforeSeq);
    return json({ items, total, loadFailed: false });
  } catch (e) {
    // 200 with a flag, not an error status: this response feeds a BACKGROUND
    // poll. A 4xx/5xx here would be indistinguishable to the caller from the
    // page-destroying failure this endpoint exists to prevent, and the thread
    // the reader is looking at is still perfectly good — it is simply one tick
    // out of date. The poller warns and retries on the next tick.
    console.warn(`[team-chat] transcript poll failed for ${params.appId}:`, e);
    return json({ items: [], total: 0, loadFailed: true }, { status: 200 });
  }
};
