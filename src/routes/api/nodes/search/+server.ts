import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { NODE_FIND_QUERY } from '$lib/server/queries';
import type { MemoryNode, SearchHitMeta } from '$lib/types';
import { NODE_FIELD_MASK_SET } from '$lib/search/node-fields';
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

// #589 (server #719): NodePropertySort enums, mirrored for input validation.
const WHERE_COLUMNS = new Set(['properties', 'data']);
const WHERE_CASTS = new Set(['text', 'number', 'datetime', 'boolean']);
const SORT_DIRECTIONS = new Set(['asc', 'desc']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// #589: validate the sortProperty shape shallowly (enums + path of strings) so
// a malformed client payload gets a clean 400 here instead of an opaque
// GraphQL variable-coercion error. The server owns the deeper rules.
function parseSortProperty(raw: unknown):
  | { path: string[]; field: string; as: string; direction: string }
  | null
  | 'invalid' {
  if (raw == null) return null;
  if (!isPlainObject(raw)) return 'invalid';
  const { path, field, as, direction } = raw as {
    path?: unknown; field?: unknown; as?: unknown; direction?: unknown;
  };
  if (!Array.isArray(path) || path.length === 0 || !path.every((p) => typeof p === 'string' && p !== '')) {
    return 'invalid';
  }
  const f = field === undefined ? 'properties' : field;
  const a = as === undefined ? 'text' : as;
  const d = direction === undefined ? 'asc' : direction;
  if (typeof f !== 'string' || !WHERE_COLUMNS.has(f)) return 'invalid';
  if (typeof a !== 'string' || !WHERE_CASTS.has(a)) return 'invalid';
  if (typeof d !== 'string' || !SORT_DIRECTIONS.has(d)) return 'invalid';
  return { path: path as string[], field: f, as: a, direction: d };
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { query, mode, memoryIds, filter, sort, sortProperty, fields } = body as {
    query?: unknown;
    mode?: unknown;
    memoryIds?: unknown;
    filter?: {
      createdBy?: unknown;
      updatedAfter?: unknown;
      updatedBefore?: unknown;
      includeDeleted?: unknown;
      objectType?: unknown;
      where?: unknown;
    };
    sort?: unknown;
    sortProperty?: unknown;
    fields?: unknown;
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
  // #433: only send includeDeleted when true — the server default is false.
  const includeDeleted = filter?.includeDeleted === true ? true : null;
  const sortMode = SORTS.includes(sort as SortMode) ? (sort as SortMode) : null;

  // #589 (server #725/#719): collection facet + structured predicate. The
  // `where` tree is forwarded opaquely — the server owns the grammar (branch
  // XOR leaf, operator set, depth/leaf/path caps) and rejects a bad tree with
  // BAD_USER_INPUT, which maps to a 400 below. Only its outer shape is
  // checked here so a scalar/array can't reach GraphQL variable coercion.
  const objectType = typeof filter?.objectType === 'string' && filter.objectType ? filter.objectType : null;
  if (filter?.where != null && !isPlainObject(filter.where)) {
    return json({ error: 'Invalid filter.' }, { status: 400 });
  }
  const where = filter?.where != null ? (filter.where as Record<string, unknown>) : null;
  const sortProp = parseSortProperty(sortProperty);
  if (sortProp === 'invalid') {
    return json({ error: 'Invalid sort.' }, { status: 400 });
  }

  // #433: validate the fields weight-mask against the known enum, drop unknowns,
  // dedupe. Null (all fields, default weights) unless a valid subset is given.
  const fieldSet = Array.isArray(fields)
    ? [...new Set(fields.filter((f): f is string => typeof f === 'string' && NODE_FIELD_MASK_SET.has(f)))]
    : [];
  // A lexical weight-mask is meaningless for a filter-only list (no ranking) and
  // is ignored by vector retrieval — only forward it for a lexical query.
  const findMode = q ? (mode === 'fuzzy' ? 'vector' : mode === 'regex' ? 'regex' : 'keyword') : null;
  const lexical = findMode === 'keyword' || findMode === 'regex';
  const searchFields = lexical && fieldSet.length > 0 ? fieldSet : null;

  const hasFilter = !!(createdBy || updatedAfter || updatedBefore || includeDeleted || objectType || where);
  // Nothing to do → let the client browse the already-loaded set. (A bare
  // loc/seq sort with no query/filter is also a client-side reorder; a
  // property sort is server-only — the slim loaded set has no properties.)
  if (!q && !hasFilter && !sortProp && (!sortMode || sortMode === 'loc' || sortMode === 'seq')) {
    return json({ nodes: [], total: null });
  }

  // findMode (computed above) maps the toggle to a server retrieval mode.
  // #430: fuzzy uses `vector` (not hybrid) so we can request `granularity:chunk`
  // and get matching-passage snippets — `hybrid + chunk` is out of scope
  // server-side. Without a vector index the server degrades
  // (reason:no_vector_index) and returns no passages. #431: `regex` is a
  // literal/pattern (substring) search — restores the substring matching lost
  // when the migration mapped Exact→keyword.
  const granularity = findMode === 'vector' ? 'chunk' : null;

  const client = gqlClient(locals.token);
  type Hit = {
    node: MemoryNode;
    score: number | null;
    vector: {
      similarity: number | null;
      model: string | null;
      abstractStale: boolean | null;
      source: string | null;
    } | null;
  };
  type FindNodesResp = {
    findNodes: {
      hits: Hit[];
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
      sortProperty: sortProp,
      granularity: g,
      fields: searchFields,
      memoryIds,
      createdBy,
      updatedAfter,
      updatedBefore,
      includeDeleted,
      objectType,
      where,
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
    const hits = r?.hits ?? [];
    const nodes = hits.map((h) => h.node);
    const hitIds = new Set(nodes.map((n) => n.id));
    // #432: per-hit relevance + vector metadata → { nodeId: SearchHitMeta }.
    // findNodes' raw `score` isn't comparable across modes (keyword ts_rank vs.
    // vector cosine vs. hybrid RRF — hadron-server#497), so surface a RELATIVE
    // indicator: each hit's score as a % of the top hit's score in this set.
    const finiteScore = (s: number | null | undefined): s is number =>
      typeof s === 'number' && Number.isFinite(s);
    // reduce (not Math.max(...spread)) — a large hit array would blow the call
    // stack when spread as arguments (PR #511 review, gemini).
    const topScore = hits.reduce((max, h) => (finiteScore(h.score) && h.score > max ? h.score : max), 0);
    const meta: Record<string, SearchHitMeta> = {};
    for (const h of hits) {
      const id = h.node?.id;
      if (!id) continue;
      const scorePct = finiteScore(h.score) && topScore > 0 ? Math.round((h.score / topScore) * 100) : null;
      const v = h.vector;
      const abstractStale = v?.abstractStale === true;
      // Only emit an entry when there's something to render (a relevance % or a
      // stale-abstract badge) — keeps the browse/filtered-list case empty.
      if (scorePct === null && !abstractStale) continue;
      meta[id] = {
        scorePct,
        abstractStale,
        similarity: v && finiteScore(v.similarity) ? v.similarity : null,
        model: v?.model ?? null,
        source: v?.source ?? null,
      };
    }
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
      meta,
      total: r?.total ?? null,
      capped: nodes.length >= SEARCH_LIMIT,
      note: degradeNote(noteReason, noteDegraded),
    });
  } catch (e: unknown) {
    // #431: a regex the server rejects (valid in JS, invalid POSIX) comes back
    // as BAD_USER_INPUT — an expected, user-driven error. Return a friendly 400
    // and don't log it (it's not a server fault, just log noise otherwise).
    // #589: a malformed `where` tree (branch+leaf mix, unknown operator,
    // depth/leaf/path caps) is the same class — surface the server's message
    // so the filter editor shows WHAT was wrong with the predicate.
    if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
      const detail = (e as { response?: { errors?: Array<{ message?: string }> } })
        ?.response?.errors?.[0]?.message;
      return json({ error: detail || 'Invalid search pattern.' }, { status: 400 });
    }
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
