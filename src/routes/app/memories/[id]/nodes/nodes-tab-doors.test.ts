/**
 * portal#1700: the Nodes tab's two paging doors. Both run as the viewer, pin a
 * singleton memory scope, answer an unreadable memory with the SAME empty page
 * an admitted empty one gets, and turn a transport failure into a retryable
 * failure, never an empty page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_SCOPE_QUERY, NODES_PAGE_QUERY, NODES_SEARCH_PAGE_QUERY, NODE_CHILDREN_QUERY } from '$lib/server/queries';
import { fakeFindNodesChildren } from '$lib/test/fakeFindNodesChildren';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

const MEM = 'mem-1';
const rows = (n: number, memoryId = MEM) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}`, loc: `a:n${String(i).padStart(3, '0')}`, name: `N${i}`, memoryId }));

type Opts = { readable?: boolean; tree?: ReturnType<typeof rows>; fail?: boolean };
function serve({ readable = true, tree = rows(45), fail = false }: Opts = {}) {
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (doc === MEMORY_SCOPE_QUERY) return { memory: readable ? { id: MEM, urn: 'hrn:mem:acme.com:m' } : null };
    if (fail) throw new Error('boom');
    if (doc === NODES_PAGE_QUERY || doc === NODES_SEARCH_PAGE_QUERY) {
      const off = vars!.offset as number;
      const lim = vars!.limit as number;
      return { findNodes: { hits: tree.slice(off, off + lim).map((node) => ({ node })) } };
    }
    if (doc === NODE_CHILDREN_QUERY) return fakeFindNodesChildren(tree, MEM)(vars);
    throw new Error(`unexpected document ${doc.slice(0, 40)}`);
  });
}

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function call(door: 'page' | 'children', search: string, token: string | null = 'tok', id = MEM) {
  const mod = door === 'page' ? await import('./page/+server') : await import('./children/+server');
  const res = await mod.GET({
    params: { id },
    locals: { token },
    url: new URL(`http://localhost/app/memories/${id}/nodes/${door}${search}`),
  } as never);
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
}
const docs = () => mockRequest.mock.calls.map(([d]) => d);

describe.each(['page', 'children'] as const)('GET nodes/%s', (door) => {
  it('refuses with no token, before any read', async () => {
    serve();
    const r = await call(door, '?offset=0', null);
    expect(r.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(['', '?offset=', '?offset=-1', '?offset=1.5', '?offset=abc', '?offset=1&offset=2', '?offset=2147483648'])(
    'a bad offset (%s) is a 400 before any read',
    async (search) => {
      serve();
      const r = await call(door, search);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ failed: true });
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('reads at the largest GraphQL Int offset', async () => {
    serve();
    expect((await call(door, '?offset=2147483647')).status).toBe(200);
  });

  it('an unreadable or concealed memory answers the SAME empty page an empty one does', async () => {
    serve({ readable: false });
    const hidden = await call(door, '?offset=0');
    serve({ tree: [] });
    const empty = await call(door, '?offset=0');
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual({ rows: [], hasMore: false });
    expect(hidden.body).toEqual(empty.body);
    // and it never read nodes for the unreadable one
    serve({ readable: false });
    mockRequest.mockClear();
    await call(door, '?offset=0');
    expect(docs()).toEqual([MEMORY_SCOPE_QUERY]);
  });

  it('a failed read is a retryable failure, not an empty page', async () => {
    serve({ fail: true });
    const r = await call(door, '?offset=0');
    expect(r.body).toEqual({ failed: true });
    expect(r.body.rows).toBeUndefined();
  });

  it('answers no-store', async () => {
    serve();
    expect((await call(door, '?offset=0')).cache).toBe('no-store');
  });

  it('resolves the route ref with the viewer and pins the RESOLVED id, not the URL value', async () => {
    serve();
    await call(door, '?offset=0', 'tok', 'hrn:mem:acme.com:m');
    const scope = mockRequest.mock.calls.find(([d]) => d === MEMORY_SCOPE_QUERY)!;
    expect(scope[1]).toEqual({ ref: 'hrn:mem:acme.com:m' });
    const read = mockRequest.mock.calls.find(([d]) => d === NODES_PAGE_QUERY || d === NODE_CHILDREN_QUERY)!;
    expect(read[1]).toMatchObject({ memoryId: MEM });
  });
});

describe('GET nodes/page', () => {
  it('asks 51 rows from the offset, shows 50, and never reads memoryNodes/memoryEdges', async () => {
    serve({ tree: rows(120) });
    const r = await call('page', '?offset=0');
    const read = mockRequest.mock.calls.find(([d]) => d === NODES_PAGE_QUERY)!;
    expect(read[1]).toEqual({ memoryId: MEM, limit: 51, offset: 0 });
    expect(r.body.rows).toHaveLength(50);
    expect(r.body.hasMore).toBe(true);
    expect(docs().every((d: string) => !/memoryNodes|memoryEdges/.test(d))).toBe(true);
  });

  it('the last page says no more (51st row is never returned)', async () => {
    serve({ tree: rows(120) });
    const r = await call('page', '?offset=100');
    expect(r.body.rows).toHaveLength(20);
    expect(r.body.hasMore).toBe(false);
  });

  it('a page of exactly 50 is complete', async () => {
    serve({ tree: rows(50) });
    const r = await call('page', '?offset=0');
    expect(r.body.rows).toHaveLength(50);
    expect(r.body.hasMore).toBe(false);
  });

  it('keeps each hit its OWN memory identity (inherited rows are not rewritten to the route memory)', async () => {
    const own = { ...rows(1)[0], memory: { id: MEM, urn: 'hrn:mem:acme.com:m', name: 'M' } };
    const base = { id: 'b1', loc: 'base:x', name: 'B', memoryId: 'mem-base', memory: { id: 'mem-base', urn: 'hrn:mem:acme.com:base', name: 'Base' } };
    serve({ tree: [own, base] as never });
    const r = await call('page', '?offset=0');
    expect(r.body.rows.map((x: { memoryId: string }) => x.memoryId)).toEqual([MEM, 'mem-base']);
    expect(r.body.rows[1].memory.id).toBe('mem-base');
  });
});

describe('GET nodes/page?q (portal#2693)', () => {
  it('searches on the server: keyword mode, the memory pinned, 51 rows from the offset', async () => {
    serve({ tree: rows(120) });
    const r = await call('page', '?offset=50&q=%20hello%20world%20');
    const read = mockRequest.mock.calls.find(([d]) => d === NODES_SEARCH_PAGE_QUERY)!;
    expect(read[1]).toEqual({ memoryId: MEM, query: 'hello world', limit: 51, offset: 50 });
    expect(NODES_SEARCH_PAGE_QUERY).toMatch(/mode: keyword/);
    expect(NODES_SEARCH_PAGE_QUERY).toMatch(/memoryRefs: \[\$memoryId\]/);
    expect(docs()).not.toContain(NODES_PAGE_QUERY);
    expect(r.body.rows).toHaveLength(50);
    expect(r.body.hasMore).toBe(true);
  });

  it.each(['', '&q=', '&q=%20%20'])('an absent or blank q (%s) browses exactly as before', async (q) => {
    serve({ tree: rows(60) });
    await call('page', `?offset=0${q}`);
    expect(docs()).toContain(NODES_PAGE_QUERY);
    expect(docs()).not.toContain(NODES_SEARCH_PAGE_QUERY);
  });

  it('refuses a repeated q and a q over the cap with a 400 before any read; the cap itself passes', async () => {
    serve();
    for (const search of ['?offset=0&q=a&q=b', `?offset=0&q=${'x'.repeat(201)}`]) {
      const r = await call('page', search);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ failed: true });
    }
    expect(mockRequest).not.toHaveBeenCalled();
    expect((await call('page', `?offset=0&q=${'x'.repeat(200)}`)).status).toBe(200);
  });

  it('an unreadable memory answers the same empty page for a search, and reads nothing', async () => {
    serve({ readable: false });
    const r = await call('page', '?offset=0&q=secret');
    expect(r.body).toEqual({ rows: [], hasMore: false });
    expect(docs()).toEqual([MEMORY_SCOPE_QUERY]);
  });

  it('a failed search is a retryable failure, never an empty result', async () => {
    serve({ fail: true });
    const r = await call('page', '?offset=0&q=x');
    expect(r.body).toEqual({ failed: true });
  });
});

describe('GET nodes/children', () => {
  it('no parent reads the top level (childrenOf "") with 21 rows and no sort', async () => {
    serve();
    const r = await call('children', '?offset=0');
    const read = mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)!;
    expect(read[1]).toEqual({ memoryId: MEM, childrenOf: '', limit: 21, offset: 0 });
    expect(r.body.rows.length).toBeLessThanOrEqual(20);
  });

  it('a parent loc is only ever the childrenOf argument under the pinned memory', async () => {
    serve();
    await call('children', '?parent=a%3Ab&offset=20');
    const read = mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)!;
    expect(read[1]).toEqual({ memoryId: MEM, childrenOf: 'a:b', limit: 21, offset: 20 });
  });

  it('a malicious parent (another memory urn, repeated, or oversized) cannot widen scope', async () => {
    serve();
    const urn = await call('children', `?parent=${encodeURIComponent('hrn:node:evil.com:other:x')}&offset=0`);
    expect(urn.status).toBe(200);
    expect(mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)![1]).toMatchObject({ memoryId: MEM });
    expect((await call('children', '?parent=a&parent=b&offset=0')).status).toBe(400);
    expect((await call('children', `?parent=${'x'.repeat(513)}&offset=0`)).status).toBe(400);
  });
});
