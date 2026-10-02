/**
 * #429 — /api/nodes/search: text query + structured filters (createdBy,
 * updatedAfter) + sort, over the unified findNodes. Mocks `$lib/server/api`'s
 * gqlClient and asserts the variables forwarded to findNodes + the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

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

  it('maps a fuzzy query to vector mode + chunk granularity (#430)', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      query: 'foo',
      mode: 'vector',
      granularity: 'chunk',
    });
  });

  it('#430: falls back to hybrid when the memory has no vector index', async () => {
    mockRequest
      .mockResolvedValueOnce({
        findNodes: { hits: [], passages: [], total: 0, reason: 'no_vector_index', degraded: null },
      })
      .mockResolvedValueOnce(findNodesResult(2));
    const res = await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ mode: 'vector', granularity: 'chunk' });
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ mode: 'hybrid', granularity: null });
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
    expect(mockRequest).toHaveBeenCalledTimes(1); // includeDeleted counts as a filter
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: null, includeDeleted: true });
    expect((await res.json()).nodes).toHaveLength(3);
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

  it('drops an unknown approval state and a non-boolean minted, so a bare browse stays local', async () => {
    const res = await POST(ev({ memoryIds: ['m1'], filter: { approvalState: 'MINTED', minted: 'yes' } }));
    expect(await res.json()).toEqual({ nodes: [], total: null });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

