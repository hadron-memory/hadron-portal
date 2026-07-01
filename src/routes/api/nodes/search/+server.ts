import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_CONTENT_SEARCH_QUERY, NODE_SEMANTIC_SEARCH_QUERY } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

// Node-content search (issue #355). Browser → this endpoint → hadron-server.
// GraphQL only runs server-side (token lives in locals), so MemoryBrowser
// fetches here the same way it already fetches /api/nodes/move + /reorder.
//
// `memoryIds` scopes the search to the page's memory set (one memory, or an
// agent's / app's several) via the server `memoryIds` arg (hadron-server#308).
// An EMPTY set short-circuits to no results — never fall through to the
// server's "all accessible memories" default, which would leak scope.

const SEARCH_LIMIT = 200;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { query, mode, memoryIds } = await request.json();
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q || !Array.isArray(memoryIds) || memoryIds.length === 0) {
    return json({ nodes: [] });
  }

  const client = gqlClient(locals.token);
  try {
    if (mode === 'fuzzy') {
      const data = await client.request<{
        findNodes: {
          hits: Array<{ node: MemoryNode }>;
          reason: string | null;
          degraded: string | null;
        };
      }>(NODE_SEMANTIC_SEARCH_QUERY, { query: q, memoryIds, mode: 'hybrid', limit: SEARCH_LIMIT });
      const r = data.findNodes;
      return json({
        nodes: (r?.hits ?? []).map((h) => h.node),
        note: degradeNote(r?.reason, r?.degraded),
      });
    }
    // default: exact / keyword (FTS over name + description + content)
    const data = await client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
      NODE_CONTENT_SEARCH_QUERY,
      { memoryIds, search: q, limit: SEARCH_LIMIT },
    );
    return json({ nodes: (data.findNodes?.hits ?? []).map((h) => h.node) });
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
