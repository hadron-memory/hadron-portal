// portal#1656: the next page of this node's direct children, for the Children
// section's "Show more". The first page comes with the page load; later pages
// are read here, never by re-running that load, whose failure would replace
// the page (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
// Follows chat-older/+server.ts.
//
// Access control is the GraphQL reads': this handler passes the caller's own
// token and re-implements no gate. The node is re-read rather than trusted from
// the URL, for its loc and to keep the read inside the memory the route names.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readChildrenPage } from '$lib/server/node-children';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const failed = (status: number) => json({ failed: true }, { status, headers });

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.token) return failed(401);
  // A missing or malformed offset is a client bug, not the first page: serving
  // page one again would read as rows the reader already has.
  const raw = url.searchParams.getAll('offset');
  if (raw.length !== 1 || !/^\d+$/.test(raw[0])) return failed(400);
  const offset = Number(raw[0]);
  // The read's offset is a GraphQL Int (signed 32-bit): refuse beyond it here,
  // before any read, rather than as a failed upstream call.
  if (offset > 2147483647) return failed(400);

  try {
    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
    if (!node || node.memoryId !== params.id) return failed(404);
    const page = await readChildrenPage(client, params.id, node.loc, offset);
    return json({ children: page.children, hasMore: page.hasMore }, { headers });
  } catch (e) {
    // 200 with a flag and no server prose: the section keeps the rows it has
    // and offers the same "Show more" again.
    console.warn(`[node-children] page read failed for ${params.nodeId}:`, e);
    return failed(200);
  }
};
