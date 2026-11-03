/**
 * portal#1656: "Show more" on the node page's Children section reads the next
 * page through this endpoint, never by re-running the page load (whose failure
 * would replace the page). It is the same `childrenOf` read as the loader's
 * first page: 20 rows asked as 21, from the offset the page asks for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, NODE_CHILDREN_QUERY } from '$lib/server/queries';
import { fakeFindNodesChildren } from '$lib/test/fakeFindNodesChildren';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

const MEM = 'mem-1';
const kids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, loc: `p:c${String(i).padStart(3, '0')}` }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function serve(tree = kids(45), node: Record<string, unknown> | null = { id: 'p-pk', memoryId: MEM, loc: 'p' }, fail = false) {
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
    if (doc === NODE_CHILDREN_QUERY) {
      if (fail) throw new Error('boom');
      return fakeFindNodesChildren(tree, MEM)(vars);
    }
    throw new Error(`unexpected document ${doc.slice(0, 40)}`);
  });
}

async function get(search: string, token: string | null = 'tok') {
  const { GET } = await import('./+server');
  const res = await GET({
    params: { id: MEM, nodeId: 'p-pk' },
    locals: { token },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/p-pk/children${search}`),
  } as never);
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
}

describe('GET children (portal#1656 "Show more")', () => {
  it('reads the page at the asked offset with childrenOf, 21 rows, no locPrefix and no sort', async () => {
    serve();
    const r = await get('?offset=20');
    expect(r.status).toBe(200);
    const call = mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)!;
    expect(call[1]).toEqual({ memoryId: MEM, childrenOf: 'p', limit: 21, offset: 20 });
    expect(r.body.children.map((c: { loc: string }) => c.loc)).toEqual(kids(40).slice(20).map((c) => c.loc));
    expect(r.body.hasMore).toBe(true);
  });

  it('reads at the largest GraphQL Int offset (the bound is not off by one)', async () => {
    serve();
    const r = await get('?offset=2147483647');
    expect(r.status).toBe(200);
    const call = mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)!;
    expect(call[1]).toMatchObject({ offset: 2147483647 });
  });

  it('the last page says no more', async () => {
    serve();
    const r = await get('?offset=40');
    expect(r.body.children).toHaveLength(5);
    expect(r.body.hasMore).toBe(false);
  });

  it('answers no-store on every branch', async () => {
    serve();
    expect((await get('?offset=20')).cache).toBe('no-store');
    expect((await get('?offset=x')).cache).toBe('no-store');
    expect((await get('?offset=20', null)).cache).toBe('no-store');
    serve(kids(45), null);
    expect((await get('?offset=20')).cache).toBe('no-store');
    serve(kids(45), undefined, true);
    expect((await get('?offset=20')).cache).toBe('no-store');
  });

  it.each(['', '?offset=', '?offset=-20', '?offset=1.5', '?offset=abc', '?offset=20&offset=40', '?offset=2147483648', '?offset=99999999999999999999'])(
    'refuses a malformed offset (%s) before any read, never defaulting to the first page',
    async (search) => {
      serve();
      const r = await get(search);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ failed: true });
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('refuses without a session before any read', async () => {
    serve();
    const r = await get('?offset=20', null);
    expect(r.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a node that is not in this memory is not found, and its children are not read', async () => {
    serve(kids(45), { id: 'p-pk', memoryId: 'other-mem', loc: 'p' });
    const r = await get('?offset=20');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ failed: true });
    expect(mockRequest.mock.calls.some(([d]) => d === NODE_CHILDREN_QUERY)).toBe(false);
  });

  it('a failed read is { failed: true } in a 200 with no server prose, not an empty page', async () => {
    serve(kids(45), undefined, true);
    const r = await get('?offset=20');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ failed: true });
  });
});
