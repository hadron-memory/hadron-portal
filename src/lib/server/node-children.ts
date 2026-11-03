import type { gqlClient } from '$lib/server/api';
import { NODE_CHILDREN_QUERY } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';

/**
 * portal#1656: one page of a loc's direct children, read with `childrenOf`
 * (hadron-server#2832; `""` is the top level).
 *
 * The page is 20 (hrn:node:hadronmemory.com:specs:cor:api:120:04: a client asks for no more unless its user
 * did). `findNodes` says nothing about whether more rows exist (`total` is null
 * on this filter, and there is no `hasMore`), so the page is asked as 21 and a
 * 21st row is the only evidence of more. It is never shown. A page of exactly
 * 20 is complete.
 *
 * No sort is sent: the rows come in the server's sibling order (hrn:node:hadronmemory.com:specs:cor:dmo:020:01,
 * positioned first, then by loc), and callers must not re-sort them.
 *
 * Throws on a failed read; each caller decides what a failure means for it.
 */
export const CHILDREN_PAGE_SIZE = 20;

export type ChildRow = Pick<MemoryNode, 'id' | 'loc' | 'name' | 'description' | 'nodeType' | 'tags' | 'seq' | 'isRunnable' | 'openThreads' | 'memoryId'>;
type ChildHit = Omit<ChildRow, 'openThreads'> & { commentSummary: { openThreads: number } | null };

export async function readChildrenPage(
  client: ReturnType<typeof gqlClient>,
  memoryId: string,
  parentLoc: string,
  offset: number,
): Promise<{ children: ChildRow[]; hasMore: boolean }> {
  const d = await client.request<{ findNodes: { hits: Array<{ node: ChildHit }> } }>(NODE_CHILDREN_QUERY, {
    memoryId,
    childrenOf: parentLoc,
    limit: CHILDREN_PAGE_SIZE + 1,
    offset,
  });
  const rows = d.findNodes.hits.map(({ node: { commentSummary, ...n } }) => ({ ...n, openThreads: commentSummary?.openThreads ?? 0 }));
  return { children: rows.slice(0, CHILDREN_PAGE_SIZE), hasMore: rows.length > CHILDREN_PAGE_SIZE };
}
