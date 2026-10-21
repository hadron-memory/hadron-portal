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
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, FIND_NODES_PAGE, FIND_NODES_PAGE * 2]);
  });

  it('does not stop at the first short page when it is the only page', async () => {
    const { client, request } = serverOf({ m: rows('n', 3) });
    await drainFindNodes(client, 'doc', { memoryIds: ['m'] });
    // The short page is confirmed by asking again: only an empty page ends the drain.
    expect(request).toHaveBeenCalledTimes(2);
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
