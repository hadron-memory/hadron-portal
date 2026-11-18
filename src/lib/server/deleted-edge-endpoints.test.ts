import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { RECOVERY_EDGES_QUERY } from '$lib/server/queries';
import { deletedEdgeEndpoints } from './deleted-edge-endpoints';

// #1161: an edge whose far endpoint is deleted is marked from recoveryEdges —
// the server's own report — never from an endpoint merely being null (a null is
// also "in a memory you cannot read", which must stay masked).
const request = vi.fn();
const client = { request } as never;

const ep = (id: string, deletedAt: string | null = null) => ({
  id, urn: `hrn:node:acme.com:notes:${id}`, loc: id, name: `Name ${id}`, deletedAt,
});
const edge = (id: string, source: ReturnType<typeof ep>, target: ReturnType<typeof ep>) => ({ id, name: 'related', source, target });

beforeEach(() => {
  request.mockReset();
});

describe('deletedEdgeEndpoints (#1161)', () => {
  it('asks nothing when no edge of the node has a missing endpoint', async () => {
    const out = await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: { id: 'a' }, target: { id: 'b' } }]);
    expect(out).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });

  it('reports the deleted side the server named, with its name and urn', async () => {
    request.mockResolvedValue({
      recoveryEdges: { items: [edge('e1', ep('gone', '2026-10-19T10:00:00Z'), ep('live'))], total: 1 },
    });
    const out = await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: null, target: { id: 'live' } }]);
    expect(request).toHaveBeenCalledWith(RECOVERY_EDGES_QUERY, { memoryRef: 'mem-1', edgeIds: ['e1'], limit: 1 });
    expect(out.e1.source).toMatchObject({ id: 'gone', name: 'Name gone' });
    expect(out.e1.target).toBeUndefined();
  });

  it('leaves an edge unmarked when the server does not list it (unreadable memory, not deleted)', async () => {
    request.mockResolvedValue({ recoveryEdges: { items: [], total: 0 } });
    const out = await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e9', source: null, target: { id: 'live' } }]);
    expect(out).toEqual({});
  });

  it('asks once for exactly three missing-edge ids, with no offset and no readable edges', async () => {
    request.mockResolvedValue({ recoveryEdges: { items: [edge('e2', ep('live'), ep('gone', '2026-10-19T10:00:00Z'))], total: 1 } });
    const out = await deletedEdgeEndpoints(client, 'mem-1', [
      { id: 'e1', source: null, target: {} }, { id: 'e2', source: {}, target: null },
      { id: 'e3', source: null, target: null }, { id: 'e2', source: null, target: null },
      { id: 'readable', source: {}, target: {} },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(RECOVERY_EDGES_QUERY, { memoryRef: 'mem-1', edgeIds: ['e1', 'e2', 'e3'], limit: 3 });
    expect(out).toEqual({ e2: { target: { id: 'gone', urn: 'hrn:node:acme.com:notes:gone', loc: 'gone', name: 'Name gone' } } });
  });

  it('sends 450 wanted edges as exactly 200/200/50 ids, without offset paging', async () => {
    request.mockResolvedValue({ recoveryEdges: { items: [], total: 0 } });
    const ids = Array.from({ length: 450 }, (_, i) => `e${i}`);
    expect(await deletedEdgeEndpoints(client, 'mem-1', ids.map(id => ({ id, source: null, target: {} })))).toEqual({});
    expect(request.mock.calls.map(([query, variables]) => ({ query, variables }))).toEqual([
      { query: RECOVERY_EDGES_QUERY, variables: { memoryRef: 'mem-1', edgeIds: ids.slice(0, 200), limit: 200 } },
      { query: RECOVERY_EDGES_QUERY, variables: { memoryRef: 'mem-1', edgeIds: ids.slice(200, 400), limit: 200 } },
      { query: RECOVERY_EDGES_QUERY, variables: { memoryRef: 'mem-1', edgeIds: ids.slice(400), limit: 50 } },
    ]);
  });

  it('an empty earlier batch does not hide a deleted endpoint in a later batch', async () => {
    request.mockResolvedValueOnce({ recoveryEdges: { items: [], total: 0 } })
      .mockResolvedValueOnce({ recoveryEdges: { items: [], total: 0 } })
      .mockResolvedValueOnce({ recoveryEdges: { items: [edge('e449', ep('gone', '2026-10-19T10:00:00Z'), ep('live'))], total: 1 } });
    const out = await deletedEdgeEndpoints(client, 'mem-1', Array.from({ length: 450 }, (_, i) => ({ id: `e${i}`, source: null, target: {} })));
    expect(request).toHaveBeenCalledTimes(3);
    expect(Object.keys(out)).toEqual(['e449']);
    expect(out.e449.source?.id).toBe('gone');
  });

  it.each(['transport', 'graphql'] as const)('a %s failure on the second batch discards earlier marks and stops', async failure => {
    request.mockResolvedValueOnce({ recoveryEdges: { items: [edge('e0', ep('gone', '2026-10-19T10:00:00Z'), ep('live'))], total: 1 } });
    if (failure === 'transport') request.mockRejectedValueOnce(new Error('socket unavailable'));
    else request.mockRejectedValueOnce(new ClientError({
      status: 200, headers: new Headers(), body: '', data: null,
      errors: [new GraphQLError('Internal server error.', { extensions: { code: 'INTERNAL_SERVER_ERROR' } })],
    }, { query: RECOVERY_EDGES_QUERY }));
    const out = await deletedEdgeEndpoints(client, 'mem-1', Array.from({ length: 450 }, (_, i) => ({ id: `e${i}`, source: null, target: {} })));
    expect(out).toEqual({});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('marks only requested edges and only endpoints explicitly reported deleted', async () => {
    request.mockResolvedValue({ recoveryEdges: { items: [
      edge('unrequested', ep('other', '2026-10-19T10:00:00Z'), ep('live')),
      edge('e1', ep('not-deleted'), ep('still-live')),
    ], total: 2 } });
    expect(await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: null, target: null }])).toEqual({});
  });

  it('marks nothing when the recovery read fails (a non-writer)', async () => {
    request.mockRejectedValue(new Error('FORBIDDEN'));
    expect(await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: null, target: { id: 'b' } }])).toEqual({});
  });
});
