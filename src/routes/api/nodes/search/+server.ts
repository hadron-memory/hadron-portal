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

  // Only a text query carries a retrieval `mode`. #430: fuzzy uses `vector`
  // (not hybrid) so we can request `granularity:chunk` and get matching-passage
  // snippets — `hybrid + chunk` is out of scope server-side. Without a vector
  // index the server degrades (reason:no_vector_index) and returns no passages.
  const findMode = q ? (mode === 'fuzzy' ? 'vector' : 'keyword') : null;
  const granularity = findMode === 'vector' ? 'chunk' : null;

  const client = gqlClient(locals.token);
  type FindNodesResp = {
    findNodes: {
      hits: Array<{ node: MemoryNode }>;
      passages: Array<{ parentNodeId: string; text: string; score: number }>;
      total: number | null;
      reason: string | null;
      degraded: string | null;
    };
  };
  const runFind = (m: string | null, g: string | null) =>
    client.request<FindNodesResp>(NODE_FIND_QUERY, {
      query: q || null,
      mode: m,
      sort: sortMode,
      granularity: g,
      memoryIds,
      createdBy,
      updatedAfter,
      updatedBefore,
      limit: SEARCH_LIMIT,
    });

  try {
    let { findNodes: r } = await runFind(findMode, granularity);
    // Preserve the ORIGINAL degrade reason so the "semantic search unavailable"
    // note still shows after a fallback (the hybrid re-run may report no reason).
    let noteReason = r?.reason ?? null;
    let noteDegraded = r?.degraded ?? null;
    // #430: vector mode powers the passage snippets, but a memory with no
    // vector index (or no embedding backend) returns nothing. Fall back to
    // hybrid (keyword+vector fusion, no passages) so a fuzzy search still
    // returns results everywhere — preserving pre-#430 behavior there.
    if (findMode === 'vector' && (noteReason === 'no_vector_index' || noteReason === 'embedding_unavailable')) {
      ({ findNodes: r } = await runFind('hybrid', null));
      noteDegraded = noteDegraded ?? r?.degraded ?? null;
    }
    const nodes = (r?.hits ?? []).map((h) => h.node);
    const hitIds = new Set(nodes.map((n) => n.id));
    // #430: best-scoring passage per node → { nodeId: snippet }, only for nodes
    // actually present in the results.
    const snippets: Record<string, string> = {};
    const bestScore: Record<string, number> = {};
    for (const p of r?.passages ?? []) {
      if (!p?.parentNodeId || typeof p.text !== 'string' || !hitIds.has(p.parentNodeId)) continue;
      const score = typeof p.score === 'number' ? p.score : 0;
      if (!(p.parentNodeId in bestScore) || score > bestScore[p.parentNodeId]) {
        bestScore[p.parentNodeId] = score;
        snippets[p.parentNodeId] = p.text;
      }
    }
    return json({
      nodes,
      snippets,
      total: r?.total ?? null,
      capped: nodes.length >= SEARCH_LIMIT,
      note: degradeNote(noteReason, noteDegraded),
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
