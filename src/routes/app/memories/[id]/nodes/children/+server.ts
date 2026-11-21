// portal#1700: one page of a folder's direct children for the Nodes tab's Tree
// (`parent` empty or absent = the memory's top level). Same access shape as
// ../page/+server.ts: the viewer's token, a re-resolved singleton memory scope,
// an unreadable memory answers an empty page, a failure is retryable.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { parseOffset, readTreePage, resolveMemoryId } from '$lib/server/nodes-tab-pages';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const failed = (status: number) => json({ failed: true }, { status, headers });
const MAX_LOC = 512;

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.token) return failed(401);
  const offset = parseOffset(url);
  if (offset === null) return failed(400);
  const parents = url.searchParams.getAll('parent');
  if (parents.length > 1) return failed(400);
  const parent = parents[0] ?? '';
  // The parent is only ever the `childrenOf` argument under a pinned memory
  // filter, so it cannot widen scope; the cap keeps a hostile value from
  // reaching the server at all.
  if (parent.length > MAX_LOC) return failed(400);
  try {
    const client = gqlClient(locals.token);
    const memoryId = await resolveMemoryId(client, params.id);
    if (!memoryId) return json({ rows: [], hasMore: false }, { headers });
    const page = await readTreePage(client, memoryId, parent, offset);
    return json(page, { headers });
  } catch (e) {
    console.warn(`[nodes-tab] tree page read failed for ${params.id}:`, e);
    return failed(200);
  }
};
