import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readSourceLint } from '$lib/server/boot-source';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

// portal#1667: source lint for one Agent, as the viewer, a page at a time. Its own
// request, so a lint fault can't take the editor with it. `page: null` in a 200 is the
// server saying lint is unavailable; a failed read is an error status, and neither is
// "no warnings".
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const headers = { 'cache-control': 'no-store' };
  try {
    const read = await withTimeout(readSourceLint(gqlClient(locals.token), params.id, url.searchParams.get('after')), OPTIONAL_LIST_TIMEOUT_MS, null);
    if (!read) return json({ error: 'Unavailable' }, { status: 404, headers });
    return json(read, { headers });
  } catch (e) {
    console.warn('[boot-source] lint read failed:', extractGqlErrorCode(e));
    return json({ error: 'Unavailable' }, { status: 502, headers });
  }
};
