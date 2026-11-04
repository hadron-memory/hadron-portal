import { json } from '@sveltejs/kit';
import { kindFromRoute } from '$lib/automation/approval';
import { gqlClient } from '$lib/server/api';
import { loadTeamGrant } from '$lib/server/automation-team-grant';
import type { RequestHandler } from './$types';

// portal#1650, LOCAL delta P2-2: the section's own re-read after Give or Stop.
// invalidateAll would put a failed __data read on kit's error page, over the
// whole page and before any catch, losing the confirmed write. Through here a
// failed re-read is a failed request the section reports itself
// (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
//
// Same token and same helper as the page's loader, so the server's gate decides:
// a refused list is `hidden` and a failed one `unavailable`, both in a 200. Only
// a caller with no session, or a route that isn't an automation, gets an HTTP error.
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const kind = kindFromRoute(params.kind);
  if (!kind) return json({ error: 'Not found' }, { status: 404 });
  const showEnded = url.searchParams.get('ended') === '1';
  const grant = await loadTeamGrant(gqlClient(locals.token), params.appId, kind, params.ref, showEnded);
  return json(grant, { headers: { 'cache-control': 'no-store' } });
};
