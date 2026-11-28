// portal#1700: one page of the memory's nodes for the Nodes tab's Table.
//
// Access control is the GraphQL reads': the viewer's own token, and the memory
// is re-resolved with it and pinned as a singleton scope. A memory the viewer
// cannot read answers the SAME empty page an admitted empty one does (no
// existence oracle); the layout's 404 already stopped the page render. A failed
// read is a retryable failure, never an empty page.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { isInvalidPatternError, parseOffset, parsePageQuery, readTablePage, resolveMemoryId } from '$lib/server/nodes-tab-pages';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const failed = (status: number) => json({ failed: true }, { status, headers });

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.token) return failed(401);
  const offset = parseOffset(url);
  if (offset === null) return failed(400);
  // portal#2693: an optional keyword search, filters and sort, run by the server over the whole
  // memory. 'My nodes' is the signed-in user of the TOKEN, never an id the client sends.
  const search = parsePageQuery(url, locals.user?.id ?? null);
  if (search === null) return failed(400);
  try {
    const client = gqlClient(locals.token);
    const memoryId = await resolveMemoryId(client, params.id);
    if (!memoryId) return json({ rows: [], hasMore: false }, { headers });
    const page = await readTablePage(client, memoryId, offset, search);
    return json(page, { headers });
  } catch (e) {
    // A pattern the server refused is the reader's to fix, not a retry; its text is never echoed or logged.
    if (search?.regex && isInvalidPatternError(e)) return json({ invalid: true }, { headers });
    // The error is NOT logged: a GraphQL error carries the request variables, i.e. the reader's search text.
    console.warn(`[nodes-tab] table page read failed for ${params.id}: ${e instanceof Error ? e.name : typeof e}`);
    return failed(200);
  }
};
