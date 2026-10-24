import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(request).toHaveBeenCalledWith(RECOVERY_EDGES_QUERY, { memoryRef: 'mem-1', limit: 200, offset: 0 });
    expect(out.e1.source).toMatchObject({ id: 'gone', name: 'Name gone' });
    expect(out.e1.target).toBeUndefined();
  });

  it('leaves an edge unmarked when the server does not list it (unreadable memory, not deleted)', async () => {
    request.mockResolvedValue({ recoveryEdges: { items: [], total: 0 } });
    const out = await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e9', source: null, target: { id: 'live' } }]);
    expect(out).toEqual({});
  });

  it('pages on until the node\'s edges are found', async () => {
    const filler = Array.from({ length: 200 }, (_, i) => edge(`x${i}`, ep(`s${i}`, '2026-10-19T10:00:00Z'), ep('t')));
    request.mockImplementation(async (_q: string, v: { offset: number }) =>
      v.offset === 0
        ? { recoveryEdges: { items: filler, total: 201 } }
        : { recoveryEdges: { items: [edge('e1', ep('live'), ep('gone', '2026-10-19T10:00:00Z'))], total: 201 } });
    const out = await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: { id: 'live' }, target: null }]);
    expect(out.e1.target).toMatchObject({ id: 'gone' });
  });

  it('marks nothing when the recovery read fails (a non-writer)', async () => {
    request.mockRejectedValue(new Error('FORBIDDEN'));
    expect(await deletedEdgeEndpoints(client, 'mem-1', [{ id: 'e1', source: null, target: { id: 'b' } }])).toEqual({});
  });
});
