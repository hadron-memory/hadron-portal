import { t } from '$lib/i18n/t';
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { NODE_FIND_QUERY, RECOVERY_NODES_QUERY } from '$lib/server/queries';
import type { MemoryNode, SearchHitMeta } from '$lib/types';
import { NODE_FIELD_MASK_SET } from '$lib/search/node-fields';
import { CONTENT_SCOPES, type CommentHit, type ContentScope } from '$lib/comments';
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

const APPROVAL_STATES = ['NOT_APPROVED', 'APPROVED', 'SUPERSEDED', 'NOT_APPLICABLE'] as const;
type ApprovalState = (typeof APPROVAL_STATES)[number];

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { query, mode, memoryIds, filter, sort, sortProperty, fields, limit: requestedLimit, scopedBrowse } = body as {
    query?: unknown;
    scopedBrowse?: unknown;
    limit?: unknown;
    mode?: unknown;
    memoryIds?: unknown;
    filter?: {
      createdBy?: unknown;
      updatedAfter?: unknown;
      updatedBefore?: unknown;
      includeDeleted?: unknown;
      objectType?: unknown;
      where?: unknown;
      approvalState?: unknown;
      minted?: unknown;
      contentScope?: unknown;
      nodeTypes?: unknown;
      tags?: unknown;
    };
    sort?: unknown;
    sortProperty?: unknown;
    fields?: unknown;
  };

  const q = typeof query === 'string' ? query.trim() : '';
  // Typeahead callers (portal#1433) ask for a handful of hits; clamp so a
  // client cannot raise the cap above SEARCH_LIMIT or send a nonsense value.
  const resultLimit =
    typeof requestedLimit === 'number' && Number.isFinite(requestedLimit)
      ? Math.min(SEARCH_LIMIT, Math.max(1, Math.floor(requestedLimit)))
      : SEARCH_LIMIT;
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
  // #992: approval and minting state. Allowlisted, so an unknown value is
  // dropped rather than reaching GraphQL enum coercion.
  const approvalState = APPROVAL_STATES.includes(filter?.approvalState as ApprovalState)
    ? (filter!.approvalState as ApprovalState)
    : null;
  const minted = typeof filter?.minted === 'boolean' ? filter.minted : null;
  // portal#1015 (hrn:node:hadronmemory.com:specs:cor:dmo:110:08): content, comments or both, filtered by the
  // SERVER before ranking and the result cap. Allowlisted; CONTENT is the server
  // default so it is never sent, and an unknown value is dropped rather than
  // reaching GraphQL enum coercion.
  const requestedScope = CONTENT_SCOPES.includes(filter?.contentScope as ContentScope)
    ? (filter!.contentScope as ContentScope)
    : null;
  const contentScope = requestedScope === 'COMMENTS' || requestedScope === 'ALL' ? requestedScope : null;
  const nodeTypes = Array.isArray(filter?.nodeTypes)
    ? [...new Set(filter.nodeTypes.filter((v): v is string => typeof v === 'string' && v.length > 0))]
    : null;
  if (nodeTypes && nodeTypes.length > 20) {
    return json({ error: 'At most 20 node types can be filtered.' }, { status: 400 });
  }
  const tags = Array.isArray(filter?.tags)
    ? [...new Set(filter.tags.filter((v): v is string => typeof v === 'string' && v.length > 0))]
    : null;
  const nodeTypeFilter = nodeTypes?.length ? nodeTypes : null;
  const tagFilter = tags?.length ? tags : null;
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

  const hasFilter = !!(createdBy || updatedAfter || updatedBefore || includeDeleted || objectType || where || approvalState || minted !== null || contentScope || nodeTypeFilter || tagFilter);
  // Nothing to do → let the client browse the already-loaded set. (A bare
  // loc/seq sort with no query/filter is also a client-side reorder; a
  // property sort is server-only — the slim loaded set has no properties.)
  // #1881/#1929 BLIND P2: a server-paged browser that narrowed memoryIds to a
  // chosen memory has no rows of that memory loaded to browse; `scopedBrowse`
  // says the scope itself is the request. Strictly `true`, never truthy.
  const scoped = scopedBrowse === true;
  if (!scoped && !q && !hasFilter && !sortProp && (!sortMode || sortMode === 'loc' || sortMode === 'seq')) {
    return json({ nodes: [], total: null });
  }

  // #1158: chunk retrieval returns passages ONLY and excludes abstract vectors.
  // Retrieve ranked nodes across all indexed sources. Passage snippets remain
  // optional; never make a node's presence depend on a content chunk existing.
  const granularity = findMode === 'vector' ? 'node' : null;

  const client = gqlClient(locals.token);
  type Hit = {
    node: MemoryNode & {
      commentSummary?: { openThreads: number } | null;
      asComment?: CommentHit | null;
    };
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
      approvalState,
      minted,
      contentScope,
      nodeTypes: nodeTypeFilter,
      tags: tagFilter,
      limit: resultLimit,
    });

  try {
    let { findNodes: r } = await runFind(findMode, granularity);
    // Preserve the ORIGINAL degrade reason so the "semantic search unavailable"
    // note still shows after a fallback (the keyword re-run may report no reason).
    const noteReason = r?.reason ?? null;
    const degraded = new Set((r?.degraded ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    let lexicalFallback = false;
    // An unavailable semantic search falls back explicitly to keyword mode.
    // A hybrid retry could recover semantic results mid-request, making the
    // keyword-only notice false (#1207 LOCAL P3).
    if (findMode === 'vector' && (noteReason === 'no_vector_index' || noteReason === 'embedding_unavailable')) {
      ({ findNodes: r } = await runFind('keyword', null));
      lexicalFallback = true;
      for (const code of (r?.degraded ?? '').split(',').map((s) => s.trim()).filter(Boolean)) degraded.add(code);
    }
    const hits = r?.hits ?? [];
    // portal#1014: the result row carries its open-thread count as the list
    // rows do (MemoryNode.openThreads); an absent summary stays absent, never 0.
    const nodes = hits.map((h) => {
      if (!h.node) return h.node;
      const { commentSummary, asComment, ...node } = h.node;
      return {
        ...node,
        ...(commentSummary ? { openThreads: commentSummary.openThreads } : {}),
        // portal#1015: a comment hit keeps its feedback shape; content has none.
        ...(asComment ? { comment: asComment } : {}),
      };
    });
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
    // Snippets are an optional, separately bounded request. Chunk retrieval
    // must never choose which ranked nodes appear (abstract-only indexes have
    // none). Keep a successful node result even if enrichment fails.
    let passages = r?.passages ?? [];
    let snippetsUnavailable = false;
    if (findMode === 'vector' && !lexicalFallback && nodes.length > 0) {
      try {
        const chunkResult = await runFind('vector', 'chunk');
        passages = chunkResult.findNodes?.passages ?? [];
        snippetsUnavailable = !!chunkResult.findNodes?.reason;
      } catch {
        snippetsUnavailable = true;
      }
    }
    // #430: best-scoring passage per node → { nodeId: snippet }, only for nodes
    // actually present in the results.
    const snippets: Record<string, string> = {};
    const bestScore: Record<string, number> = {};
    for (const p of passages) {
      if (!p?.parentNodeId || typeof p.text !== 'string' || !hitIds.has(p.parentNodeId)) continue;
      const score = typeof p.score === 'number' ? p.score : 0;
      if (!(p.parentNodeId in bestScore) || score > bestScore[p.parentNodeId]) {
        bestScore[p.parentNodeId] = score;
        snippets[p.parentNodeId] = p.text;
      }
    }
    const deletedIds = includeDeleted ? await deletedNodeIds(client, memoryIds as string[]) : undefined;
    return json({
      nodes,
      ...(deletedIds ? { deletedIds } : {}),
      snippets,
      meta,
      total: r?.total ?? null,
      capped: nodes.length >= resultLimit,
      reason: noteReason,
      degraded: [...degraded],
      note: [degradeNote(noteReason, degraded, lexicalFallback, nodes.length), snippetsUnavailable ? t('search.snippets-unavailable', 'Matching passages are unavailable; ranked node results are shown.') : null].filter(Boolean).join(' ') || null,
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
      // Fallback copy matches what the request actually carried — a
      // message-less rejection of a where/sortProperty request shouldn't
      // blame the search pattern (PR #616 review).
      const fallback = where || sortProp ? 'Invalid filter or sort.' : 'Invalid search pattern.';
      return json({ error: detail || fallback }, { status: 400 });
    }
    // Log detail server-side; return a generic message so GraphQL/DB internals
    // (query shapes, schema, server state) aren't leaked to the client (PR #358
    // review — security).
    console.error('[/api/nodes/search] failed:', e);
    return json({ error: 'Search failed' }, { status: 500 });
  }
};

// Preserve codes separately for diagnostics; render only translated explanations.
function degradeNote(reason: string | null, degraded: Set<string>, fallback: boolean, count: number): string | null {
  const flags = new Set([...degraded, ...(reason ? [reason] : [])]);
  const parts: string[] = [];
  if (flags.has('no_vector_index')) parts.push(t('search.no-index', 'Semantic search is unavailable because these memories have no vector index.'));
  if (flags.has('embedding_unavailable')) parts.push(t('search.backend-unavailable', 'Semantic search is temporarily unavailable.'));
  if (fallback) parts.push(count > 0
    ? t('search.keyword-fallback', 'Showing keyword matches instead of semantic matches.')
    : t('search.keyword-empty', 'No keyword matches found either.'));
  if (flags.has('and_relaxed_to_or')) parts.push(t('search.any-term', 'Results may match any search term.'));
  if (flags.has('literal_fallback')) parts.push(t('search.literal-fallback', 'Showing literal text matches.'));
  if (flags.has('scope_narrowed')) parts.push(t('search.scope-narrowed', 'Only memories you can read were searched.'));
  if ([...flags].some((f) => !['no_vector_index', 'embedding_unavailable', 'and_relaxed_to_or', 'literal_fallback', 'scope_narrowed'].includes(f))) {
    parts.push(t('search.reduced-fidelity', 'Search ran with reduced capabilities.'));
  }
  return parts.length ? parts.join(' ') : null;
}

// #1161: ids of the deleted nodes in the searched memories, read from the server
// (recoveryNodes) so a row is marked only when the server says it is deleted.
// Writer-only: a read that throws, or any memory it cannot read, yields undefined
// and the list simply shows no marks — never a guess from what is missing.
const RECOVERY_PAGE = 200;
const RECOVERY_MAX_PAGES = 25;
async function deletedNodeIds(
  client: ReturnType<typeof gqlClient>,
  memoryIds: string[],
): Promise<string[] | undefined> {
  const ids = new Set<string>();
  try {
    for (const memoryRef of memoryIds.filter((m): m is string => typeof m === 'string')) {
      let read = 0; // per memory: `total` counts that memory's deleted nodes only
      for (let page = 0; page < RECOVERY_MAX_PAGES; page++) {
        const r = await client.request<{ recoveryNodes?: { items: Array<{ id: string }>; total: number } | null }>(
          RECOVERY_NODES_QUERY, { memoryRef, limit: RECOVERY_PAGE, offset: page * RECOVERY_PAGE },
        );
        const items = r?.recoveryNodes?.items;
        if (!items) return undefined;
        for (const it of items) ids.add(it.id);
        read += items.length;
        if (items.length < RECOVERY_PAGE || read >= (r.recoveryNodes?.total ?? 0)) break;
      }
    }
  } catch {
    return undefined;
  }
  return [...ids];
}
