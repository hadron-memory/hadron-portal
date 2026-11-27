import type { gqlClient } from '$lib/server/api';
import { MEMORY_SCOPE_QUERY, NODES_PAGE_QUERY, NODES_SEARCH_PAGE_QUERY } from '$lib/server/queries';
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
/** A search longer than this is refused (400) before any read. */
export const SEARCH_MAX_LENGTH = 200;

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

/**
 * The optional `q`: undefined = browse (absent or blank), a string = keyword
 * search, null = a client bug (repeated, or over the cap) answered 400.
 */
export function parseSearch(url: URL): string | undefined | null {
  const raw = url.searchParams.getAll('q');
  if (raw.length === 0) return undefined;
  if (raw.length !== 1) return null;
  const q = raw[0].trim();
  if (q === '') return undefined;
  return q.length > SEARCH_MAX_LENGTH ? null : q;
}

export type TablePageRow = Pick<MemoryNode, 'id' | 'urn' | 'loc' | 'name' | 'description' | 'nodeType' | 'tags' | 'seq' | 'isRunnable' | 'memoryId' | 'updatedAt' | 'memory'>;

export async function readTablePage(
  client: NodesTabClient,
  memoryId: string,
  offset: number,
  search?: string,
): Promise<{ rows: TablePageRow[]; hasMore: boolean }> {
  const d = await client.request<{ findNodes: { hits: Array<{ node: TablePageRow & { commentSummary?: unknown } }> } }>(
    search === undefined ? NODES_PAGE_QUERY : NODES_SEARCH_PAGE_QUERY,
    search === undefined
      ? { memoryId, limit: TABLE_PAGE_SIZE + 1, offset }
      : { memoryId, query: search, limit: TABLE_PAGE_SIZE + 1, offset },
  );
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
