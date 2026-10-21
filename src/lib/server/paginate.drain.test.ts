/**
 * #1226 / hadron-server#2211 — a `findNodes` browse is drained to an EMPTY page,
 * never to the first short one, one memory at a time.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { drainFindNodes, FIND_NODES_PAGE } from './paginate';

const hit = (id: string) => ({ node: { id } });
const rows = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => hit(`${prefix}${i}`));

/** A server holding `store[memoryId]`, honouring limit/offset. */
function serverOf(store: Record<string, ReturnType<typeof hit>[]>) {
  const request = vi.fn(async (_doc: string, v: { memoryIds: string[]; limit: number; offset: number }) => ({
    findNodes: { hits: store[v.memoryIds[0]].slice(v.offset, v.offset + v.limit) },
  }));
  return { client: { request } as unknown as GraphQLClient, request };
}

describe('drainFindNodes (#1226)', () => {
  it('reads past the first page and stops on an empty one', async () => {
    const { client, request } = serverOf({ m: rows('n', FIND_NODES_PAGE + 7) });
    const out = await drainFindNodes(client, 'doc', { memoryIds: ['m'] });
    expect(out.findNodes.hits).toHaveLength(FIND_NODES_PAGE + 7);
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, FIND_NODES_PAGE, FIND_NODES_PAGE + 7]);
  });

  it('does not stop at the first short page when it is the only page', async () => {
    const { client, request } = serverOf({ m: rows('n', 3) });
    await drainFindNodes(client, 'doc', { memoryIds: ['m'] });
    // The short page is confirmed by asking again: only an empty page ends the drain.
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('loses nothing when the server clamps the page below the request (short NON-empty pages)', async () => {
    const all = rows('n', 55);
    const request = vi.fn(async (_d: string, v: { limit: number; offset: number }) => ({
      findNodes: { hits: all.slice(v.offset, v.offset + Math.min(v.limit, 20)) },
    }));
    const out = await drainFindNodes({ request } as unknown as GraphQLClient, 'doc', { memoryIds: ['m'] });
    expect(out.findNodes.hits.map((h) => h.node.id)).toEqual(all.map((h) => h.node.id));
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, 20, 40, 55]);
  });

  it('crosses the 20-row boundary without loss at exactly 20, 21 and 40 rows', async () => {
    for (const n of [20, 21, 40]) {
      const all = rows('n', n);
      const request = vi.fn(async (_d: string, v: { limit: number; offset: number }) => ({
        findNodes: { hits: all.slice(v.offset, v.offset + Math.min(v.limit, 20)) },
      }));
      const out = await drainFindNodes({ request } as unknown as GraphQLClient, 'doc', { memoryIds: ['m'] });
      expect(out.findNodes.hits).toHaveLength(n);
    }
  });

  it('a later-page failure rejects with the rows already read discarded', async () => {
    const all = rows('n', 55);
    const request = vi.fn(async (_d: string, v: { limit: number; offset: number }) => {
      if (v.offset >= 20) throw new Error('page 2 failed');
      return { findNodes: { hits: all.slice(v.offset, v.offset + 20) } };
    });
    await expect(drainFindNodes({ request } as unknown as GraphQLClient, 'doc', { memoryIds: ['m'] })).rejects.toThrow('page 2 failed');
  });

  it('drains each memory on its own request', async () => {
    const { client, request } = serverOf({ a: rows('a', 2), b: rows('b', 3) });
    const out = await drainFindNodes(client, 'doc', { memoryIds: ['a', 'b'], nodeType: 'system' });
    expect(out.findNodes.hits.map((h) => h.node.id)).toEqual(['a0', 'a1', 'b0', 'b1', 'b2']);
    for (const [, v] of request.mock.calls) {
      expect(v.memoryIds).toHaveLength(1);
      expect(v).toMatchObject({ nodeType: 'system' });
    }
  });

  it('stops when a page adds nothing new (a server that ignores offset)', async () => {
    const request = vi.fn(async () => ({ findNodes: { hits: rows('n', 4) } }));
    const out = await drainFindNodes({ request } as unknown as GraphQLClient, 'doc', { memoryIds: ['m'] });
    expect(out.findNodes.hits).toHaveLength(4);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed page instead of returning a partial list', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ findNodes: { hits: rows('n', 2) } })
      .mockRejectedValueOnce(new Error('boom'));
    await expect(drainFindNodes({ request } as unknown as GraphQLClient, 'doc', { memoryIds: ['m'] })).rejects.toThrow('boom');
  });
});

describe('fetchAllItems (#1226)', () => {
  it('continues past a short NON-empty page and loses nothing when the server clamps below 200', async () => {
    const { fetchAllItems } = await import('./paginate');
    const all = Array.from({ length: 55 }, (_, i) => ({ id: `o${i}` }));
    const request = vi.fn(async (_d: string, v: { limit: number; offset: number }) => ({
      organizations: { items: all.slice(v.offset, v.offset + Math.min(v.limit, 20)), total: all.length },
    }));
    const out = await fetchAllItems<{ id: string }>({ request } as unknown as GraphQLClient, 'doc', 'organizations');
    expect(out).toEqual(all);
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, 20, 40]);
  });

  it('a later-page failure rejects instead of returning the first page', async () => {
    const { fetchAllItems } = await import('./paginate');
    const request = vi.fn()
      .mockResolvedValueOnce({ organizations: { items: [{ id: 'a' }], total: 400 } })
      .mockRejectedValueOnce(new Error('page 2 failed'));
    await expect(fetchAllItems({ request } as unknown as GraphQLClient, 'doc', 'organizations')).rejects.toThrow('page 2 failed');
  });
});
