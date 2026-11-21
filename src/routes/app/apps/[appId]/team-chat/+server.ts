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
import { loadTeamChatNewer, loadTeamChatOlder, loadTeamChatTail, teamChatRefusalOf } from '$lib/server/team-chat';
import { parseTeamParam } from '$lib/team-chat-filter';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  // `?beforeSeq=` pages backward for scroll-up; `?sinceSeq=` pages forward for
  // refresh without skipping a burst larger than one page. No cursor asks for
  // the newest page (first paint or recovery from an initial failed read).
  const beforeSeqRaw = url.searchParams.get('beforeSeq');
  const sinceSeqRaw = url.searchParams.get('sinceSeq');
  const beforeSeq = beforeSeqRaw === null ? null : Number(beforeSeqRaw);
  const sinceSeq = sinceSeqRaw === null ? null : Number(sinceSeqRaw);
  // A malformed cursor is a client bug, not an empty thread. Refusing beats
  // silently falling back to the tail, which would re-serve the page the reader
  // already has and read to the component as "no more history".
  // #793 (@copilot on PR #799): a strictly positive SAFE INTEGER. `Number()`
  // happily yields 10.5 and 10e2, and the GraphQL variable is an `Int` — so a
  // non-integer becomes a runtime GraphQL error or an unintended cursor instead
  // of the clean 400 this guard exists to produce.
  if (
    (beforeSeqRaw !== null && (!Number.isSafeInteger(beforeSeq) || (beforeSeq as number) <= 0)) ||
    (sinceSeqRaw !== null && (!Number.isSafeInteger(sinceSeq) || (sinceSeq as number) <= 0)) ||
    (beforeSeqRaw !== null && sinceSeqRaw !== null)
  ) {
    return json({ items: [], total: 0, loadFailed: true, reason: 'bad-cursor' }, { status: 400 });
  }

  // #1137/#1482: the team filter rides every read — tail, older and newer
  // alike — and is applied by the SERVER, ahead of paging and `total`. The
  // selection is a set carried as repeated `?team=` values; like a cursor, a
  // malformed value (or `untagged` mixed with heads) is refused, never served
  // as the unfiltered thread.
  const team = parseTeamParam(url.searchParams.getAll('team'));
  if (!team.ok) {
    return json({ items: [], total: 0, loadFailed: true, reason: 'bad-team' }, { status: 400 });
  }
  const filter = team.filter;

  try {
    // Every path reads one bounded page. The tail helper supplies a high
    // backward cursor so server #1536's default direction does not affect us.
    const client = gqlClient(locals.token);
    const { items, total } =
      beforeSeq !== null
        ? await loadTeamChatOlder(client, params.appId, beforeSeq, undefined, filter)
        : sinceSeq !== null
          ? await loadTeamChatNewer(client, params.appId, sinceSeq, filter)
          : await loadTeamChatTail(client, params.appId, filter);
    return json({ items, total, loadFailed: false });
  } catch (e) {
    // 200 with a flag, not an error status: this response feeds a BACKGROUND
    // poll. A 4xx/5xx here would be indistinguishable to the caller from the
    // page-destroying failure this endpoint exists to prevent, and the thread
    // the reader is looking at is still perfectly good — it is simply one tick
    // out of date. The poller warns and retries on the next tick.
    console.warn(`[team-chat] transcript poll failed for ${params.appId}:`, e);
    // #1137: the server's typed head refusal is an ANSWER, not a blip. Hand it
    // to the thread so it can say so; every other failure stays the bare flag.
    const refusal = filter.kind === 'teams' ? teamChatRefusalOf(e) : null;
    return json(
      refusal ? { items: [], total: 0, loadFailed: true, refusal } : { items: [], total: 0, loadFailed: true },
      { status: 200 },
    );
  }
};
