import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_FIND_QUERY } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

// Node search + structured filter (issues #355, #429). Browser → this endpoint
// → hadron-server's unified `findNodes`. GraphQL only runs server-side (token
// lives in locals), so MemoryBrowser fetches here the same way it fetches
// /api/nodes/move + /reorder.
//
// `memoryIds` scopes the request to the page's memory set (hadron-server#308).
// An EMPTY set short-circuits to no results — never fall through to the server's
// "all accessible memories" default, which would leak scope.
//
// #429: beyond the text `query`, callers can pass a structured `filter`
// (createdBy = "my nodes", updatedAfter/Before = "changed since") and a `sort`.
// A request with no query but a filter/sort is valid — findNodes returns a
// deterministically-ordered filtered list.

const SEARCH_LIMIT = 500;

type SortMode = 'loc' | 'seq' | 'updatedAt' | 'relevance';
const SORTS: readonly SortMode[] = ['loc', 'seq', 'updatedAt', 'relevance'];

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { query, mode, memoryIds, filter, sort } = body as {
    query?: unknown;
    mode?: unknown;
    memoryIds?: unknown;
    filter?: { createdBy?: unknown; updatedAfter?: unknown; updatedBefore?: unknown };
    sort?: unknown;
  };

  const q = typeof query === 'string' ? query.trim() : '';
  if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
    return json({ nodes: [], total: null });
  }

  const createdBy = typeof filter?.createdBy === 'string' && filter.createdBy ? filter.createdBy : null;
  const updatedAfter =
    typeof filter?.updatedAfter === 'string' && filter.updatedAfter ? filter.updatedAfter : null;
  const updatedBefore =
    typeof filter?.updatedBefore === 'string' && filter.updatedBefore ? filter.updatedBefore : null;
  const sortMode = SORTS.includes(sort as SortMode) ? (sort as SortMode) : null;

  const hasFilter = !!(createdBy || updatedAfter || updatedBefore);
  // Nothing to do → let the client browse the already-loaded set. (A bare
  // loc/seq sort with no query/filter is also a client-side reorder.)
  if (!q && !hasFilter && (!sortMode || sortMode === 'loc' || sortMode === 'seq')) {
    return json({ nodes: [], total: null });
  }

  // Only a text query carries a retrieval `mode`; a filter-only list ignores it.
  const findMode = q ? (mode === 'fuzzy' ? 'hybrid' : 'keyword') : null;

  const client = gqlClient(locals.token);
  try {
    const data = await client.request<{
      findNodes: {
        hits: Array<{ node: MemoryNode }>;
        total: number | null;
        reason: string | null;
        degraded: string | null;
      };
    }>(NODE_FIND_QUERY, {
      query: q || null,
      mode: findMode,
      sort: sortMode,
      memoryIds,
      createdBy,
      updatedAfter,
      updatedBefore,
      limit: SEARCH_LIMIT,
    });
    const r = data.findNodes;
    return json({
      nodes: (r?.hits ?? []).map((h) => h.node),
      total: r?.total ?? null,
      capped: (r?.hits?.length ?? 0) >= SEARCH_LIMIT,
      note: degradeNote(r?.reason, r?.degraded),
    });
  } catch (e: unknown) {
    // Log detail server-side; return a generic message so GraphQL/DB internals
    // (query shapes, schema, server state) aren't leaked to the client (PR #358
    // review — security).
    console.error('[/api/nodes/search] failed:', e);
    return json({ error: 'Search failed' }, { status: 500 });
  }
};

// Turn the server's structured fuzzy-search flags into one human line the UI
// can show — chiefly to steer the user back to Exact when no vector index or
// embedding backend is available.
function degradeNote(
  reason: string | null | undefined,
  degraded: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (degraded) parts.push(degraded);
  if (reason === 'no_vector_index') {
    parts.push('No vector index on these memories — semantic search is unavailable. Try Exact.');
  } else if (reason === 'embedding_unavailable') {
    parts.push('Semantic search backend is unavailable right now. Try Exact.');
  } else if (reason) {
    parts.push(reason);
  }
  return parts.length ? parts.join(' ') : null;
}
