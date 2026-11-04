import type { gqlClient } from '$lib/server/api';
import { MEMORY_SCOPE_QUERY, NODES_PAGE_QUERY } from '$lib/server/queries';
import { CHILDREN_PAGE_SIZE, readChildrenPage, type ChildRow } from '$lib/server/node-children';
import type { MemoryNode } from '$lib/types';

/**
 * portal#1700: the two bounded reads behind the restored Nodes tab. Neither
 * touches `memoryNodes`/`memoryEdges` (the server flag still empties them) and
 * neither drains: one page per call.
 *
 * `findNodes` has no `hasMore` and a null `total` on these filters, so a page
 * is asked as N+1 and the extra row is the only evidence of more. It is never
 * returned.
 */
export const TABLE_PAGE_SIZE = 50;
export const OFFSET_MAX = 2147483647;

export type NodesTabClient = ReturnType<typeof gqlClient>;

/** The viewer's own read of the route's memory ref; null for unreadable AND absent alike. */
export async function resolveMemoryId(client: NodesTabClient, ref: string): Promise<string | null> {
  const d = await client.request<{ memory: { id: string } | null }>(MEMORY_SCOPE_QUERY, { ref });
  return d.memory?.id ?? null;
}

/** A single digit-only `offset` within a GraphQL Int, else null (a client bug, never "page one"). */
export function parseOffset(url: URL): number | null {
  const raw = url.searchParams.getAll('offset');
  if (raw.length !== 1 || !/^\d+$/.test(raw[0])) return null;
  const n = Number(raw[0]);
  return n > OFFSET_MAX ? null : n;
}

export type TablePageRow = Pick<MemoryNode, 'id' | 'loc' | 'name' | 'description' | 'nodeType' | 'tags' | 'seq' | 'isRunnable' | 'memoryId' | 'updatedAt' | 'memory'>;

export async function readTablePage(
  client: NodesTabClient,
  memoryId: string,
  offset: number,
): Promise<{ rows: TablePageRow[]; hasMore: boolean }> {
  const d = await client.request<{ findNodes: { hits: Array<{ node: TablePageRow & { commentSummary?: unknown } }> } }>(NODES_PAGE_QUERY, {
    memoryId,
    limit: TABLE_PAGE_SIZE + 1,
    offset,
  });
  const rows = d.findNodes.hits.map(({ node: { commentSummary: _c, ...n } }) => n as TablePageRow);
  return { rows: rows.slice(0, TABLE_PAGE_SIZE), hasMore: rows.length > TABLE_PAGE_SIZE };
}

export async function readTreePage(
  client: NodesTabClient,
  memoryId: string,
  parentLoc: string,
  offset: number,
): Promise<{ rows: ChildRow[]; hasMore: boolean }> {
  const { children, hasMore } = await readChildrenPage(client, memoryId, parentLoc, offset);
  return { rows: children, hasMore };
}

export { CHILDREN_PAGE_SIZE };
