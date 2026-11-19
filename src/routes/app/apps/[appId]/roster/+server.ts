// portal#2238 — the App roster as an isolated, bounded read for the AI Team
// grid's first-show fetch.
//
// The page load no longer brings the roster for any tab but an initial
// ?tab=staff (ruling 0273: load only what the first screen renders; in prod
// teamRoster took 30-60 s and hung every other tab behind the page's
// Promise.all). Tab switches are client state — `activeTab = id`, no
// navigation — so nothing reloads when a reader lands on AI Team from another
// tab. The page asks HERE, once per visit, on that first show.
//
// The degrade contract is the team-chat endpoints': this response feeds a
// background fetch, so a failing or hung roster read answers
// `{ kind: 'failed' }` with status 200 — never a throw, never server text —
// and costs the Task/Paused cells their state, never the page. The read is
// bounded at the same 8 s optional-list bound the loader uses, so a hung
// teamRoster cannot hold this request's connection either. A session-less
// caller is NOT a degraded read: it gets the repo's endpoint 401
// (grants/list/+server.ts pattern), because there is no member to gate.
//
// Access control is the GraphQL query's (`teamRoster(appRef:)` is
// App-membership gated server-side) with the caller's own token, exactly as
// for the page load. No portal-side gate is re-implemented here: a second
// copy of an authorization rule is the drift this repo keeps filing issues
// about, and the weaker copy always wins.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadAppTeamRoster, type TeamRosterRead } from '$lib/server/app-team-roster';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token || !locals.user?.id) {
    return json({ kind: 'failed' } satisfies TeamRosterRead, { status: 401, headers });
  }
  const read = await withTimeout(
    loadAppTeamRoster(gqlClient(locals.token), params.appId),
    OPTIONAL_LIST_TIMEOUT_MS,
    { kind: 'failed' } satisfies TeamRosterRead,
  );
  return json(read, { headers });
};
