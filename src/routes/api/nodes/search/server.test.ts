/**
 * #429 — /api/nodes/search: text query + structured filters (createdBy,
 * updatedAfter) + sort, over the unified findNodes. Mocks `$lib/server/api`'s
 * gqlClient and asserts the variables forwarded to findNodes + the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { RECOVERY_NODES_QUERY } from '$lib/server/queries';
import { POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as unknown as Parameters<
    typeof POST
  >[0];
}

function findNodesResult(hits: number, total: number | null = null) {
  return {
    findNodes: {
      hits: Array.from({ length: hits }, (_, i) => ({ node: { id: `n${i}` } })),
      passages: [],
      total,
      reason: null,
      degraded: null,
    },
  };
}

describe('/api/nodes/search (#429)', () => {
  it('401s without a token', async () => {
    const res = await POST(ev({ memoryIds: ['m1'] }, null));
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns empty (no server call) when memoryIds is empty', async () => {
    const res = await POST(ev({ query: 'x', memoryIds: [] }));
    expect(await res.json()).toEqual({ nodes: [], total: null });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does nothing for a bare browse (no query, no filter, loc sort)', async () => {
    const res = await POST(ev({ memoryIds: ['m1'], sort: 'loc' }));
    expect(await res.json()).toEqual({ nodes: [], total: null });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('forwards createdBy ("my nodes") with no query as a filter-only list', async () => {
    mockRequest.mockResolvedValue(findNodesResult(2, 2));
    const res = await POST(ev({ memoryIds: ['m1'], filter: { createdBy: 'u1' } }));
    const body = await res.json();
    expect(body.nodes).toHaveLength(2);
    expect(body.total).toBe(2);
    const vars = mockRequest.mock.calls[0][1];
    expect(vars).toMatchObject({ createdBy: 'u1', query: null, mode: null, memoryIds: ['m1'] });
  });

  it('forwards updatedAfter + sort', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ memoryIds: ['m1'], filter: { updatedAfter: '2026-07-01T00:00:00.000Z' }, sort: 'updatedAt' }));
    const vars = mockRequest.mock.calls[0][1];
    expect(vars).toMatchObject({ updatedAfter: '2026-07-01T00:00:00.000Z', sort: 'updatedAt' });
  });

  it("portal#1014 (Jane on #1025): a result row carries its open-thread count; an absent summary stays absent", async () => {
    mockRequest.mockResolvedValueOnce({
      findNodes: {
        hits: [
          { node: { id: 'a', commentSummary: { openThreads: 2 } } },
          { node: { id: 'b', commentSummary: { openThreads: 0 } } },
          { node: { id: 'c' } },
        ],
        passages: [],
        total: 3,
        reason: null,
        degraded: null,
      },
    });
    const res = await POST(ev({ query: 'foo', memoryIds: ['m1'] }));
    const { nodes } = await res.json();
    expect(nodes).toEqual([{ id: 'a', openThreads: 2 }, { id: 'b', openThreads: 0 }, { id: 'c' }]);
  });

  it('maps fuzzy to node vectors so abstract-only indexes remain searchable (#1158)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      query: 'foo',
      mode: 'vector',
      granularity: 'node',
    });
  });

  it('#1162: falls back explicitly to keyword when the memory has no vector index', async () => {
    mockRequest
      .mockResolvedValueOnce({
        findNodes: { hits: [], passages: [], total: 0, reason: 'no_vector_index', degraded: null },
      })
      .mockResolvedValueOnce(findNodesResult(2));
    const res = await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'vector', granularity: 'node' });
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ mode: 'keyword', granularity: null });
    expect((await res.json()).nodes).toHaveLength(2);
  });

  it('keyword (exact) search requests no chunk granularity', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'exact', memoryIds: ['m1'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'keyword', granularity: null });
  });

  it('#431: regex mode maps to mode:regex with no chunk granularity', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo.*bar', mode: 'regex', memoryIds: ['m1'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'regex', granularity: null });
  });

  it('#431: a BAD_USER_INPUT (bad regex) surfaces as a friendly 400', async () => {
    // graphql-request throws a ClientError carrying `.response.errors`. Use
    // `mockRejectedValueOnce` (not the persistent `mockRejectedValue`) so
    // vitest's spy doesn't leave a floating tracked rejection that surfaces as
    // a test failure. The endpoint returns 400 before it logs, so no spy needed.
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('invalid regex'), {
        response: { errors: [{ message: 'invalid regex', extensions: { code: 'BAD_USER_INPUT' } }] },
      }),
    );
    const res = await POST(ev({ query: '(', mode: 'regex', memoryIds: ['m1'] }));
    expect(res.status).toBe(400);
    // #589: the server's own BAD_USER_INPUT detail is surfaced (it also covers
    // where-grammar rejections); the generic copy is only the fallback.
    expect((await res.json()).error).toBe('invalid regex');
  });

  it('falls back to the generic 400 copy when BAD_USER_INPUT carries no message', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        response: { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] },
      }),
    );
    const res = await POST(ev({ query: '(', mode: 'regex', memoryIds: ['m1'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid search pattern.');
  });

  it('#432: per-hit meta — relevance % relative to top + stale-abstract flag', async () => {
    mockRequest.mockResolvedValue({
      findNodes: {
        hits: [
          {
            node: { id: 'n1' },
            score: 0.5,
            vector: { similarity: 0.9, model: 'text-embed', abstractStale: true, source: 'chunk' },
          },
          { node: { id: 'n2' }, score: 0.25, vector: null }, // half the top score
          { node: { id: 'n3' }, score: null, vector: null }, // unscored → no entry
        ],
        passages: [],
        total: 3,
        reason: null,
        degraded: null,
      },
    });
    const res = await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    const body = await res.json();
    expect(body.meta.n1).toEqual({
      scorePct: 100,
      abstractStale: true,
      similarity: 0.9,
      model: 'text-embed',
      source: 'chunk',
    });
    expect(body.meta.n2).toMatchObject({ scorePct: 50, abstractStale: false });
    // n3 has neither a score nor a stale flag → no entry (nothing to render).
    expect(body.meta.n3).toBeUndefined();
  });

  it('#432: an unscored filtered list (no query) yields no relevance meta', async () => {
    mockRequest.mockResolvedValue(findNodesResult(2, 2));
    const res = await POST(ev({ memoryIds: ['m1'], filter: { createdBy: 'u1' } }));
    expect((await res.json()).meta).toEqual({});
  });

  it('#433: forwards a valid fields weight-mask on a lexical (exact) query, dropping unknowns', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'exact', memoryIds: ['m1'], fields: ['name', 'content', 'bogus'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'keyword', fields: ['name', 'content'] });
  });

  it('#433: does NOT send fields for a fuzzy (vector) query — the mask is lexical-only', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'], fields: ['name'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'vector', fields: null });
  });

  it('#433: an all-unknown fields list sends null (all fields / server default)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'exact', memoryIds: ['m1'], fields: ['nope', 'zzz'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ fields: null });
  });

  it('#433: includeDeleted is forwarded and drives a filter-only fetch (no query)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(3, 3));
    const res = await POST(ev({ memoryIds: ['m1'], filter: { includeDeleted: true } }));
    // includeDeleted counts as a filter (one findNodes) and asks the server which rows are deleted (#1161)
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: null, includeDeleted: true });
    expect((await res.json()).nodes).toHaveLength(3);
  });

  describe('#1161: deleted rows are marked from the server, never inferred', () => {
    const page = (ids: string[], total: number) => ({ recoveryNodes: { items: ids.map((id) => ({ id })), total } });

    it('returns the ids recoveryNodes reports for each searched memory', async () => {
      mockRequest.mockImplementation(async (q: string) =>
        q === RECOVERY_NODES_QUERY ? page(['n1', 'n2'], 2) : findNodesResult(3, 3));
      const body = await (await POST(ev({ memoryIds: ['m1'], filter: { includeDeleted: true } }))).json();
      expect(mockRequest).toHaveBeenCalledWith(RECOVERY_NODES_QUERY, { memoryRef: 'm1', limit: 200, offset: 0 });
      expect(body.deletedIds).toEqual(['n1', 'n2']);
    });

    it('pages through recoveryNodes until every deleted id is read', async () => {
      const first = Array.from({ length: 200 }, (_, i) => `a${i}`);
      mockRequest.mockImplementation(async (q: string, v: { offset?: number }) =>
        q === RECOVERY_NODES_QUERY ? (v.offset === 0 ? page(first, 203) : page(['b0', 'b1', 'b2'], 203)) : findNodesResult(1, 1));
      const body = await (await POST(ev({ memoryIds: ['m1'], filter: { includeDeleted: true } }))).json();
      expect(body.deletedIds).toHaveLength(203);
      expect(mockRequest).toHaveBeenCalledWith(RECOVERY_NODES_QUERY, { memoryRef: 'm1', limit: 200, offset: 200 });
    });

    it('reads every page of EACH memory: a later memory is not cut short by an earlier one\'s count (#1242 READ)', async () => {
      const a = Array.from({ length: 200 }, (_, i) => `a${i}`);
      const b1 = Array.from({ length: 200 }, (_, i) => `b${i}`);
      mockRequest.mockImplementation(async (q: string, v: { memoryRef?: string; offset?: number }) => {
        if (q !== RECOVERY_NODES_QUERY) return findNodesResult(1, 1);
        if (v.memoryRef === 'mA') return page(a, 200);
        return v.offset === 0 ? page(b1, 201) : page(['b200'], 201);
      });
      const body = await (await POST(ev({ memoryIds: ['mA', 'mB'], filter: { includeDeleted: true } }))).json();
      expect(body.deletedIds).toHaveLength(401);
      expect(body.deletedIds).toContain('b200');
    });

    it('does not ask when Include deleted is off', async () => {
      mockRequest.mockResolvedValue(findNodesResult(1));
      const body = await (await POST(ev({ query: 'foo', mode: 'exact', memoryIds: ['m1'], filter: { includeDeleted: false } }))).json();
      expect(mockRequest.mock.calls.some(([q]) => q === RECOVERY_NODES_QUERY)).toBe(false);
      expect(body.deletedIds).toBeUndefined();
    });

    it('keeps the node list and marks nothing when the recovery read fails (a non-writer)', async () => {
      mockRequest.mockImplementation(async (q: string) => {
        if (q === RECOVERY_NODES_QUERY) throw new Error('FORBIDDEN');
        return findNodesResult(2, 2);
      });
      const body = await (await POST(ev({ memoryIds: ['m1'], filter: { includeDeleted: true } }))).json();
      expect(body.nodes).toHaveLength(2);
      expect(body.deletedIds).toBeUndefined();
    });
  });

  it('#433: includeDeleted omitted/false sends null (server default excludes deleted)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'exact', memoryIds: ['m1'], filter: { includeDeleted: false } }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ includeDeleted: null });
  });

  it('#430: best passage per node, only for nodes present in the hits', async () => {
    mockRequest.mockResolvedValue({
      findNodes: {
        hits: [{ node: { id: 'n1' } }, { node: { id: 'n2' } }],
        passages: [
          { parentNodeId: 'n1', text: 'weaker chunk', score: 0.4 },
          { parentNodeId: 'n1', text: 'best chunk', score: 0.9 },
          { parentNodeId: 'n2', text: 'other node chunk', score: 0.7 },
          { parentNodeId: 'ghost', text: 'not in hits', score: 0.99 }, // dropped
        ],
        total: 2,
        reason: null,
        degraded: null,
      },
    });
    const res = await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    const body = await res.json();
    expect(body.snippets).toEqual({ n1: 'best chunk', n2: 'other node chunk' });
  });

  it('flags capped when the result hits the limit', async () => {
    mockRequest.mockResolvedValue(findNodesResult(500));
    const res = await POST(ev({ query: 'foo', memoryIds: ['m1'] }));
    expect((await res.json()).capped).toBe(true);
  });

  // ── #589 (server #719/#725): objectType facet + where predicate + sortProperty ──

  it('#589: forwards objectType as a filter-only fetch (no query)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(2, 2));
    const res = await POST(ev({ memoryIds: ['m1'], filter: { objectType: 'competitor' } }));
    expect((await res.json()).nodes).toHaveLength(2);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      objectType: 'competitor',
      query: null,
      where: null,
      sortProperty: null,
    });
  });

  it('#589: forwards the where tree opaquely and composes it with a query', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    const where = { and: [{ path: ['stage'], eq: 'seed' }, { path: ['fundingUsd'], as: 'number', gte: 5 }] };
    await POST(ev({ query: 'acme', memoryIds: ['m1'], filter: { where } }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: 'acme', mode: 'keyword', where });
  });

  it('#589: 400s a non-object where without calling the server', async () => {
    for (const bad of ['scalar', [1, 2]]) {
      const res = await POST(ev({ memoryIds: ['m1'], filter: { where: bad } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid filter.');
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('#589: a sortProperty alone drives a server fetch and fills shape defaults', async () => {
    mockRequest.mockResolvedValue(findNodesResult(3, 3));
    const res = await POST(ev({ memoryIds: ['m1'], sortProperty: { path: ['fundingUsd'], as: 'number' } }));
    expect((await res.json()).nodes).toHaveLength(3);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      sortProperty: { path: ['fundingUsd'], field: 'properties', as: 'number', direction: 'asc' },
    });
  });

  it('#589: 400s a malformed sortProperty without calling the server', async () => {
    for (const bad of [
      'fundingUsd',                                  // not an object
      { path: [] },                                  // empty path
      { path: ['a', 7] },                            // non-string segment
      { path: ['a'], field: 'content' },             // unknown column
      { path: ['a'], as: 'json' },                   // unknown cast
      { path: ['a'], direction: 'up' },              // unknown direction
    ]) {
      const res = await POST(ev({ memoryIds: ['m1'], sortProperty: bad }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid sort.');
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('#589: a message-less BAD_USER_INPUT on a structured request falls back to filter/sort copy', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        response: { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] },
      }),
    );
    const res = await POST(ev({ memoryIds: ['m1'], filter: { where: { path: ['x'], eq: 1 } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid filter or sort.');
  });

  it("#589: a server where-grammar rejection (BAD_USER_INPUT) surfaces the server's message", async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('where: depth exceeds 4'), {
        response: { errors: [{ message: 'where: depth exceeds 4', extensions: { code: 'BAD_USER_INPUT' } }] },
      }),
    );
    const res = await POST(ev({ memoryIds: ['m1'], filter: { where: { path: ['x'], eq: 1 } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('where: depth exceeds 4');
  });
});

describe('/api/nodes/search approval and minting filters (#992)', () => {
  it('forwards approvalState and minted as a filter-only list', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1, 1));
    await POST(ev({ memoryIds: ['m1'], filter: { approvalState: 'SUPERSEDED', minted: false } }));
    const vars = mockRequest.mock.calls[0][1];
    expect(vars).toMatchObject({ approvalState: 'SUPERSEDED', minted: false, memoryIds: ['m1'], query: null });
  });

  it('forwards NOT_APPLICABLE, the encrypted-memory state (portal#1088, hadron-server#1637)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1, 1));
    await POST(ev({ memoryIds: ['m1'], filter: { approvalState: 'NOT_APPLICABLE' } }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ approvalState: 'NOT_APPLICABLE' });
  });

  it('drops an unknown approval state and a non-boolean minted, so a bare browse stays local', async () => {
    const res = await POST(ev({ memoryIds: ['m1'], filter: { approvalState: 'MINTED', minted: 'yes' } }));
    expect(await res.json()).toEqual({ nodes: [], total: null });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});



// portal#1015 (hrn:node:hadronmemory.com:specs:cor:dmo:110:08): Content / Comments / All is a SERVER filter,
// applied before ranking and the 500-hit cap. The endpoint forwards it; it
// never filters a returned page.
describe('/api/nodes/search content scope (portal#1015)', () => {
  const commentHit = {
    id: 'c1',
    isTopLevel: true,
    state: 'OPEN',
    anchorRevision: 2,
    deleted: false,
    author: { kind: 'WORKER', worker: { id: 'w1', name: 'Gil', handle: null, urn: 'hrn:worker:o:a:gil' }, user: null, agent: null, app: null },
    target: { id: 't1', name: 'Target', nodeType: 'info', revSeq: 5, urn: 'hrn:node:o:m:t' },
  };

  it('forwards COMMENTS, and a comments list with no query is a valid filter-only search', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    const res = await POST(ev({ memoryIds: ['m1'], filter: { contentScope: 'COMMENTS' } }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ contentScope: 'COMMENTS', query: null, memoryIds: ['m1'] });
  });

  it.each(['keyword', 'regex', 'fuzzy'] as const)('forwards ALL with a %s query', async (mode) => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'retention', mode: mode === 'keyword' ? 'exact' : mode, memoryIds: ['m1'], filter: { contentScope: 'ALL' } }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ contentScope: 'ALL', query: 'retention' });
  });

  it('sends no scope for CONTENT (the server default), so a bare CONTENT request browses client-side', async () => {
    const res = await POST(ev({ memoryIds: ['m1'], filter: { contentScope: 'CONTENT' } }));
    expect(await res.json()).toEqual({ nodes: [], total: null });
    expect(mockRequest).not.toHaveBeenCalled();
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'x', memoryIds: ['m1'], filter: { contentScope: 'CONTENT' } }));
    expect(mockRequest.mock.calls[0][1].contentScope).toBeNull();
  });

  it('drops an unknown scope rather than reaching GraphQL enum coercion', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'x', memoryIds: ['m1'], filter: { contentScope: 'EVERYTHING' } }));
    expect(mockRequest.mock.calls[0][1].contentScope).toBeNull();
  });

  it('hands a comment hit to the client as `comment`, and leaves content hits without one', async () => {
    mockRequest.mockResolvedValue({
      findNodes: {
        hits: [
          { node: { id: 'c1', nodeType: 'comment', asComment: commentHit, commentSummary: null } },
          { node: { id: 'n1', nodeType: 'info', asComment: null, commentSummary: { openThreads: 2 } } },
        ],
        passages: [], total: 2, reason: null, degraded: null,
      },
    });
    const body = await (await POST(ev({ query: 'x', memoryIds: ['m1'], filter: { contentScope: 'ALL' } }))).json();
    expect(body.nodes[0].comment).toEqual(commentHit);
    expect(body.nodes[0]).not.toHaveProperty('asComment');
    expect(body.nodes[1]).not.toHaveProperty('comment');
    expect(body.nodes[1].openThreads).toBe(2);
    expect(body.total).toBe(2);
  });
});


describe('semantic search regressions (#1158/#1162)', () => {
  it('returns abstract-only vector hits in server rank order', async () => {
    mockRequest.mockImplementation(async (_query, vars) => ({ findNodes: {
      hits: vars.granularity === 'chunk' ? [] : [
        { node: { id: 'abstract-best' }, score: 0.9 },
        { node: { id: 'abstract-next' }, score: 0.6 },
      ], passages: [], total: null, reason: null, degraded: null,
    } }));
    const res = await POST(ev({ query: 'invented information', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect((await res.json()).nodes.map((n: {id: string}) => n.id)).toEqual(['abstract-best', 'abstract-next']);
  });

  it('explains an actual lexical fallback without raw comma-separated codes', async () => {
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: [], passages: [], total: 0, reason: 'no_vector_index', degraded: 'no_vector_index,scope_narrowed' } })
      .mockResolvedValueOnce({ findNodes: { hits: [{node: {id: 'lexical'}}], passages: [], total: 1, reason: null, degraded: 'and_relaxed_to_or' } });
    const body = await (await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }))).json();
    expect(body.note).toContain('Showing keyword matches instead');
    expect(body.note).not.toContain('no_vector_index');
    expect(body.note).toContain('any search term');
    expect(body.reason).toBe('no_vector_index');
    expect(body.degraded).toEqual(['no_vector_index', 'scope_narrowed', 'and_relaxed_to_or']);
  });

  it('does not claim keyword matches when the fallback is empty', async () => {
    mockRequest.mockResolvedValueOnce({ findNodes: { hits: [], passages: [], total: 0, reason: 'embedding_unavailable', degraded: null } })
      .mockResolvedValueOnce(findNodesResult(0));
    const body = await (await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }))).json();
    expect(body.note).toContain('No keyword matches found');
    expect(body.note).not.toContain('Showing keyword matches');
  });
});

it('#1158: optional passages cannot replace node ranking or introduce another node', async () => {
  mockRequest.mockResolvedValueOnce({ findNodes: { hits: [{node: {id: 'abstract'}, score: 0.9}, {node: {id: 'content'}, score: 0.8}], passages: [], total: null, reason: null, degraded: null } })
    .mockResolvedValueOnce({findNodes: {hits: [], passages: [{parentNodeId: 'content', text: 'matching passage', score: 0.8}, {parentNodeId: 'outside', text: 'outside result window', score: 1}], total: null, reason: null, degraded: null}});
  const body = await (await POST(ev({query: 'facts', mode: 'fuzzy', memoryIds: ['m1']}))).json();
  expect(body.nodes.map((n: {id: string}) => n.id)).toEqual(['abstract', 'content']);
  expect(body.snippets).toEqual({content: 'matching passage'});
  expect(mockRequest.mock.calls[1][1]).toMatchObject({granularity: 'chunk', memoryIds: ['m1'], limit: 500});
});

it('#1158: a failed optional passage request preserves successful nodes', async () => {
  mockRequest.mockResolvedValueOnce(findNodesResult(1)).mockRejectedValueOnce(new Error('unavailable'));
  const res = await POST(ev({query: 'facts', mode: 'fuzzy', memoryIds: ['m1']}));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.nodes).toHaveLength(1);
  expect(body.note).toContain('Matching passages are unavailable');
});

it('#1207 LOCAL P3: transient embedding recovery must not make a keyword-labelled fallback semantic', async () => {
  mockRequest.mockImplementation(async (_doc, vars) => ({findNodes: vars.mode === 'vector'
    ? {hits: [], passages: [], total: 0, reason: 'embedding_unavailable', degraded: null}
    : {hits: [{node: {id: vars.mode === 'hybrid' ? 'recovered-semantic-hit' : 'keyword-hit'}}], passages: [], total: 1, reason: null, degraded: null}
  }));
  const body = await (await POST(ev({query: 'facts', mode: 'fuzzy', memoryIds: ['m1']}))).json();
  expect(body.nodes.map((n: {id: string}) => n.id)).toEqual(['keyword-hit']);
  expect(mockRequest.mock.calls[1][1]).toMatchObject({mode: 'keyword', granularity: null});
  expect(body.note).toContain('Showing keyword matches instead');
});
