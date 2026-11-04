import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readResolvedSource } from '$lib/server/boot-source';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

// portal#1667: the "As readers see it" read. The node comes from the Agent, so this
// can't be pointed at anything else, and it reads with the viewer's own token: includes
// are filled in by the server for this reader. A failure says nothing about why.
export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const headers = { 'cache-control': 'no-store' };
  try {
    const node = await withTimeout(readResolvedSource(gqlClient(locals.token), params.id), OPTIONAL_LIST_TIMEOUT_MS, null);
    if (!node) return json({ error: 'Unavailable' }, { status: 404, headers });
    return json({ node }, { headers });
  } catch (e) {
    console.warn('[boot-source] resolved read failed:', extractGqlErrorCode(e));
    return json({ error: 'Unavailable' }, { status: 502, headers });
  }
};
