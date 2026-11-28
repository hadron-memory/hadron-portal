import type { gqlClient } from '$lib/server/api';
import { MEMORY_SCOPE_QUERY, NODES_PAGE_QUERY, NODES_SEARCH_PAGE_QUERY } from '$lib/server/queries';
import { CHILDREN_PAGE_SIZE, readChildrenPage, type ChildRow } from '$lib/server/node-children';
import { NODE_TYPES, isHiddenNodeType } from '$lib/node-types';
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

/** What the Nodes tab may filter and sort by: every value is an allow-list entry or a capped shape, never passed through. */
export const FILTER_LIST_MAX = 20;
export const TAG_MAX_LENGTH = 100;
/** The types the tab lists (hidden ones are not offered: see isHiddenNodeType). */
export const FILTERABLE_NODE_TYPES: readonly string[] = NODE_TYPES.filter((n) => !isHiddenNodeType(n));
export const CHANGED_WINDOWS = { '24h': 1, '7d': 7, '30d': 30 } as const;
/** portal#2706: the comments door. Absent (or 'content') is the default, content only; never passed through. */
export const SCOPES = { comments: 'COMMENTS', all: 'ALL' } as const;
export const SORTS = { loc: 'loc', updated: 'updatedAt', relevance: 'relevance' } as const;

export interface PageQuery {
  q?: string;
  nodeTypes?: string[];
  tags?: string[];
  sort?: (typeof SORTS)[keyof typeof SORTS];
  updatedAfter?: string;
  createdBy?: string;
  contentScope?: (typeof SCOPES)[keyof typeof SCOPES];
}

/** The one value of a single-valued param: undefined = absent or blank, null = repeated. */
function one(url: URL, name: string): string | undefined | null {
  const raw = url.searchParams.getAll(name);
  if (raw.length === 0) return undefined;
  if (raw.length !== 1) return null;
  const v = raw[0].trim();
  return v === '' ? undefined : v;
}

/**
 * The optional search, filters and sort of one page. Returns undefined for the plain paged list
 * (nothing asked), a PageQuery for a narrowed one, or null for a request the client should never
 * send (answered 400 before any read): a repeated single param, an over-cap or unlisted value, or
 * `mine` with no signed-in viewer. `viewerId` is the TOKEN's user, never a client-supplied id.
 */
export function parsePageQuery(url: URL, viewerId: string | null, now = Date.now()): PageQuery | undefined | null {
  const out: PageQuery = {};
  const q = one(url, 'q');
  if (q === null) return null;
  if (q !== undefined) {
    if (q.length > SEARCH_MAX_LENGTH) return null;
    out.q = q;
  }
  const types = [...new Set(url.searchParams.getAll('type').map((v) => v.trim()).filter((v) => v !== ''))];
  if (types.length > FILTER_LIST_MAX || !types.every((v) => FILTERABLE_NODE_TYPES.includes(v))) return null;
  if (types.length) out.nodeTypes = types;
  const tags = [...new Set(url.searchParams.getAll('tag').map((v) => v.trim()).filter((v) => v !== ''))];
  // eslint-disable-next-line no-control-regex
  if (tags.length > FILTER_LIST_MAX || !tags.every((v) => v.length <= TAG_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(v))) return null;
  if (tags.length) out.tags = tags;
  const sort = one(url, 'sort');
  if (sort === null || (sort !== undefined && !Object.hasOwn(SORTS, sort))) return null;
  if (sort !== undefined) out.sort = SORTS[sort as keyof typeof SORTS];
  const changed = one(url, 'changed');
  if (changed === null || (changed !== undefined && !Object.hasOwn(CHANGED_WINDOWS, changed))) return null;
  if (changed !== undefined) {
    out.updatedAfter = new Date(now - CHANGED_WINDOWS[changed as keyof typeof CHANGED_WINDOWS] * 86_400_000).toISOString();
  }
  const scope = one(url, 'scope');
  if (scope === null || (scope !== undefined && scope !== 'content' && !Object.hasOwn(SCOPES, scope))) return null;
  if (scope !== undefined && scope !== 'content') out.contentScope = SCOPES[scope as keyof typeof SCOPES];
  const mine = one(url, 'mine');
  if (mine === null || (mine !== undefined && mine !== '1')) return null;
  if (mine !== undefined) {
    if (!viewerId) return null;
    out.createdBy = viewerId;
  }
  return Object.keys(out).length ? out : undefined;
}

export type TablePageRow = Pick<MemoryNode, 'id' | 'urn' | 'loc' | 'name' | 'description' | 'nodeType' | 'tags' | 'seq' | 'isRunnable' | 'memoryId' | 'updatedAt' | 'memory'> & { comment?: unknown };

export async function readTablePage(
  client: NodesTabClient,
  memoryId: string,
  offset: number,
  query?: PageQuery,
): Promise<{ rows: TablePageRow[]; hasMore: boolean }> {
  const d = await client.request<{ findNodes: { hits: Array<{ node: TablePageRow & { commentSummary?: unknown; asComment?: unknown } }> } }>(
    query === undefined ? NODES_PAGE_QUERY : NODES_SEARCH_PAGE_QUERY,
    query === undefined
      ? { memoryId, limit: TABLE_PAGE_SIZE + 1, offset }
      : {
          memoryId,
          query: query.q ?? null,
          // keyword only: never regex, vector or hybrid from the browser
          mode: query.q === undefined ? null : 'keyword',
          sort: query.sort ?? null,
          createdBy: query.createdBy ?? null,
          updatedAfter: query.updatedAfter ?? null,
          nodeTypes: query.nodeTypes ?? null,
          tags: query.tags ?? null,
          contentScope: query.contentScope ?? null,
          limit: TABLE_PAGE_SIZE + 1,
          offset,
        },
  );
  // portal#2706: a comment hit keeps its feedback shape as `comment` (what NodeList renders); content has none.
  const rows = d.findNodes.hits.map(({ node: { commentSummary: _c, asComment, ...n } }) => (asComment ? { ...n, comment: asComment } : n) as TablePageRow);
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
