/**
 * #429 — /api/nodes/search: text query + structured filters (createdBy,
 * updatedAfter) + sort, over the unified findNodes. Mocks `$lib/server/api`'s
 * gqlClient and asserts the variables forwarded to findNodes + the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

beforeEach(() => mockRequest.mockReset());

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as unknown as Parameters<
    typeof POST
  >[0];
}

function findNodesResult(hits: number, total: number | null = null) {
  return {
    findNodes: {
      hits: Array.from({ length: hits }, (_, i) => ({ node: { id: `n${i}` } })),
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

  it('maps a fuzzy query to hybrid mode', async () => {
    mockRequest.mockResolvedValue(findNodesResult(1));
    await POST(ev({ query: 'foo', mode: 'fuzzy', memoryIds: ['m1'] }));
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ query: 'foo', mode: 'hybrid' });
  });

  it('flags capped when the result hits the limit', async () => {
    mockRequest.mockResolvedValue(findNodesResult(500));
    const res = await POST(ev({ query: 'foo', memoryIds: ['m1'] }));
    expect((await res.json()).capped).toBe(true);
  });
});
