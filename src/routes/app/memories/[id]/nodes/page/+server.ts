// portal#1700: one page of the memory's nodes for the Nodes tab's Table.
//
// Access control is the GraphQL reads': the viewer's own token, and the memory
// is re-resolved with it and pinned as a singleton scope. A memory the viewer
// cannot read answers the SAME empty page an admitted empty one does (no
// existence oracle); the layout's 404 already stopped the page render. A failed
// read is a retryable failure, never an empty page.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { parseOffset, parseSearch, readTablePage, resolveMemoryId } from '$lib/server/nodes-tab-pages';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const failed = (status: number) => json({ failed: true }, { status, headers });

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.token) return failed(401);
  const offset = parseOffset(url);
  if (offset === null) return failed(400);
  // portal#2693: an optional keyword search, run by the server over the whole memory.
  const search = parseSearch(url);
  if (search === null) return failed(400);
  try {
    const client = gqlClient(locals.token);
    const memoryId = await resolveMemoryId(client, params.id);
    if (!memoryId) return json({ rows: [], hasMore: false }, { headers });
    const page = await readTablePage(client, memoryId, offset, search);
    return json(page, { headers });
  } catch (e) {
    console.warn(`[nodes-tab] table page read failed for ${params.id}:`, e);
    return failed(200);
  }
};
