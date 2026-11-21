// portal#2311 — the App's registered hosts, for the Grant-scope dialog's host
// picker. Fetched when the dialog opens, never on the Keys tab's first screen
// (ruling 0273), and never cached: the answer is one App's, for one reader.
//
// Access control is the GraphQL read's (hostRegistrations is gated to the
// readers of the App's tasks and events, hrn:node:hadronmemory.com:specs:cor:agt:050:21), run with the
// caller's own token; no second copy of the rule lives here. A refusal or a
// failure is a 200 with its kind, because the dialog degrades on it.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadAppHosts } from '$lib/server/app-hosts';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token || !locals.user?.id) {
    return json({ kind: 'failed' }, { status: 401, headers });
  }
  const read = await withTimeout(loadAppHosts(gqlClient(locals.token), params.appId), OPTIONAL_LIST_TIMEOUT_MS, {
    kind: 'failed' as const,
  });
  return json(read, { headers });
};
