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

async function call(door: 'page' | 'children', search: string, token: string | null = 'tok', id = MEM, user: { id: string } | null = { id: 'user-1' }) {
  const mod = door === 'page' ? await import('./page/+server') : await import('./children/+server');
  const res = await mod.GET({
    params: { id },
    locals: { token, user },
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
    expect(read[1]).toEqual({ memoryId: MEM, query: 'hello world', mode: 'keyword', sort: null, createdBy: null, updatedAfter: null, nodeTypes: null, tags: null, contentScope: null, limit: 51, offset: 50 });
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

describe('GET nodes/page filters and sort (portal#2693 step 1)', () => {
  const vars = () => mockRequest.mock.calls.find(([d]) => d === NODES_SEARCH_PAGE_QUERY)![1] as Record<string, unknown>;

  it('passes types, tags, sort and the changed window to findNodes, and no query or mode for a filter-only list', async () => {
    serve({ tree: rows(60) });
    const now = Date.now();
    const r = await call('page', '?offset=0&type=info&type=prompt&type=info&tag=a&tag=b&sort=updated&changed=7d');
    const v = vars();
    expect(v).toMatchObject({ memoryId: MEM, query: null, mode: null, sort: 'updatedAt', nodeTypes: ['info', 'prompt'], tags: ['a', 'b'], createdBy: null, limit: 51, offset: 0 });
    const ms = now - Date.parse(v.updatedAfter as string);
    expect(Math.abs(ms - 7 * 86_400_000)).toBeLessThan(10_000);
    expect(r.body.rows).toHaveLength(50);
    expect(docs()).not.toContain(NODES_PAGE_QUERY);
  });

  it("'my nodes' is the signed-in user of the token, and is refused with no user", async () => {
    serve();
    await call('page', '?offset=0&mine=1');
    expect(vars().createdBy).toBe('user-1');
    mockRequest.mockClear();
    const r = await call('page', '?offset=0&mine=1', 'tok', MEM, null);
    expect(r.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a client-supplied user id is ignored: createdBy is never read from the URL', async () => {
    serve();
    await call('page', '?offset=0&createdBy=someone-else&userId=someone-else');
    expect(docs()).toContain(NODES_PAGE_QUERY);
    expect(docs()).not.toContain(NODES_SEARCH_PAGE_QUERY);
    mockRequest.mockClear();
    await call('page', '?offset=0&mine=1&createdBy=someone-else');
    expect(vars().createdBy).toBe('user-1');
  });

  it.each([
    '&type=system', '&type=record', '&type=comment', '&type=nope', '&type=info%0Aprompt',
    '&sort=seq', '&sort=score', '&sort=updated&sort=loc',
    '&changed=1y', '&changed=2026-01-01', '&changed=7d&changed=24h',
    '&mine=0', '&mine=true', '&mine=1&mine=1',
    `&tag=${'x'.repeat(101)}`, '&tag=a%00b',
    `&${Array.from({ length: 21 }, (_, i) => `tag=t${i}`).join('&')}`,
    `&${['info', 'reference', 'prompt', 'data', 'chat', 'abstract', 'info2'].map((t) => `type=${t}`).join('&')}`,
  ])('%s is a 400 before any read', async (extra) => {
    serve();
    const r = await call('page', `?offset=0${extra}`);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ failed: true });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('the caps themselves pass: 20 tags, 100-char tag, every listed type', async () => {
    serve();
    const tags = Array.from({ length: 20 }, (_, i) => `tag=${'x'.repeat(100 - String(i).length)}${i}`).join('&');
    expect((await call('page', `?offset=0&${tags}`)).status).toBe(200);
    expect((await call('page', '?offset=0&type=info&type=reference&type=prompt&type=data&type=chat&type=abstract')).status).toBe(200);
  });

  it("'my nodes' with a client-sent userId is still the token's user", async () => {
    serve();
    await call('page', '?offset=0&mine=1&userId=someone-else');
    expect(vars().createdBy).toBe('user-1');
  });

  it('sort=relevance with no q is accepted and passed through; the server answers its unranked browse', async () => {
    serve({ tree: rows(5) });
    const r = await call('page', '?offset=0&sort=relevance');
    expect(r.status).toBe(200);
    expect(vars()).toMatchObject({ query: null, mode: null, sort: 'relevance' });
  });

  it('never asks the server for vector, hybrid, deleted rows or a property filter', async () => {
    serve();
    await call('page', '?offset=0&q=x&includeDeleted=true&where=%7B%7D');
    expect(NODES_SEARCH_PAGE_QUERY).not.toMatch(/includeDeleted|where|vector|hybrid/);
    expect(vars().mode).toBe('keyword');
  });

  it('an unreadable memory answers the same empty page for a filtered read, and reads nothing', async () => {
    serve({ readable: false });
    const r = await call('page', '?offset=0&type=info&mine=1');
    expect(r.body).toEqual({ rows: [], hasMore: false });
    expect(docs()).toEqual([MEMORY_SCOPE_QUERY]);
  });
});

describe('GET nodes/page comments scope (portal#2706 PR 1)', () => {
  const vars = () => mockRequest.mock.calls.find(([d]) => d === NODES_SEARCH_PAGE_QUERY)![1] as Record<string, unknown>;
  const asComment = { id: 'c1', isTopLevel: true, state: 'OPEN', anchorRevision: 2, deleted: false, author: { kind: 'USER', user: { id: 'u', handle: 'h', name: 'H', urn: null }, agent: null, worker: null, app: null }, target: { id: 't', name: 'Target', nodeType: 'info', revSeq: 3, urn: 'hrn:node:acme.com:m:t' } };

  it('comments and all pass the server enum; the pinned memory still scopes the read', async () => {
    serve();
    await call('page', '?offset=0&scope=comments');
    expect(vars()).toMatchObject({ memoryId: MEM, contentScope: 'COMMENTS', query: null, mode: null, limit: 51 });
    mockRequest.mockClear();
    serve();
    await call('page', '?offset=0&q=x&scope=all');
    expect(vars()).toMatchObject({ memoryId: MEM, contentScope: 'ALL', query: 'x', mode: 'keyword' });
  });

  it('the default stays content only: no scope param is the plain list, and scope=content sends no contentScope', async () => {
    serve();
    await call('page', '?offset=0');
    expect(docs()).toContain(NODES_PAGE_QUERY);
    expect(docs()).not.toContain(NODES_SEARCH_PAGE_QUERY);
    mockRequest.mockClear();
    serve();
    await call('page', '?offset=0&scope=content&q=x');
    expect(vars().contentScope).toBeNull();
  });

  it.each(['?offset=0&scope=regex', '?offset=0&scope=COMMENTS', '?offset=0&scope=all&scope=comments', '?offset=0&scope=__proto__'])(
    'refuses %s with a 400 before any read',
    async (search) => {
      serve();
      const r = await call('page', search);
      expect(r.status).toBe(400);
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('a comment hit keeps its feedback shape as `comment`; a content hit has none', async () => {
    serve({ tree: [{ id: 'k1', loc: 'comments:c1', name: 'c', memoryId: MEM, asComment } as never, { id: 'n1', loc: 'a:n1', name: 'N', memoryId: MEM, asComment: null } as never] });
    const r = await call('page', '?offset=0&scope=all');
    expect(r.body.rows[0].comment).toMatchObject({ id: 'c1', target: { name: 'Target' } });
    expect(r.body.rows[0]).not.toHaveProperty('asComment');
    expect(r.body.rows[1]).not.toHaveProperty('comment');
  });

  it('the search selection reads asComment (author, target, anchor)', () => {
    expect(NODES_SEARCH_PAGE_QUERY).toMatch(/asComment\s*{[\s\S]*target\s*{/);
    expect(NODES_SEARCH_PAGE_QUERY).toMatch(/\$contentScope: NodeContentScope/);
  });

  it('an unreadable memory answers the same empty page and reads nothing', async () => {
    serve({ readable: false });
    const r = await call('page', '?offset=0&scope=comments');
    expect(r.body).toEqual({ rows: [], hasMore: false });
    expect(docs()).toEqual([MEMORY_SCOPE_QUERY]);
  });

  it('a cancelled or timed-out search is a retryable failure, and the search text never reaches the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === MEMORY_SCOPE_QUERY) return { memory: { id: MEM } };
      throw Object.assign(new Error('canceling statement due to statement timeout: SECRET-PATTERN-42'), { request: { variables: { query: 'SECRET-PATTERN-42' } } });
    });
    const r = await call('page', '?offset=0&scope=comments&q=SECRET-PATTERN-42');
    expect(r.body).toEqual({ failed: true });
    expect(JSON.stringify(r)).not.toContain('SECRET-PATTERN-42');
    expect(JSON.stringify(warn.mock.calls.map((c) => c.map((a) => (a instanceof Error ? [a.name, a.message, a.stack] : a))))).not.toContain('SECRET-PATTERN-42');
  });
});

describe('GET nodes/page regex mode (portal#2706 PR 2)', () => {
  const vars = () => mockRequest.mock.calls.find(([d]) => d === NODES_SEARCH_PAGE_QUERY)![1] as Record<string, unknown>;
  const PATTERN = 'SECRET-(a|b)+$';

  it('mode=regex sends the pattern as the query in regex mode, keyword stays the default, and the memory stays pinned', async () => {
    serve();
    await call('page', `?offset=0&mode=regex&q=${encodeURIComponent(PATTERN)}`);
    expect(vars()).toMatchObject({ memoryId: MEM, query: PATTERN, mode: 'regex', limit: 51 });
    mockRequest.mockClear();
    serve();
    await call('page', '?offset=0&mode=keyword&q=x');
    expect(vars().mode).toBe('keyword');
  });

  it.each(['?offset=0&mode=vector&q=x', '?offset=0&mode=hybrid&q=x', '?offset=0&mode=REGEX&q=x', '?offset=0&mode=regex&mode=keyword&q=x', '?offset=0&mode=regex', '?offset=0&mode=regex&q=%20%20'])(
    'refuses %s with a 400 before any read',
    async (search) => {
      serve();
      const r = await call('page', search);
      expect(r.status).toBe(400);
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('the 200-character cap: 201 is a 400 before any read naming no pattern text; 200 passes', async () => {
    serve();
    const r = await call('page', `?offset=0&mode=regex&q=${'a'.repeat(201)}`);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('aaaa');
    expect(mockRequest).not.toHaveBeenCalled();
    const ok = await call('page', `?offset=0&mode=regex&q=${'a'.repeat(200)}`);
    expect(ok.status).toBe(200);
    expect(vars().mode).toBe('regex');
  });

  it('an invalid pattern is its own answer, not a retryable failure, and the pattern reaches neither the response nor the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === MEMORY_SCOPE_QUERY) return { memory: { id: MEM } };
      throw Object.assign(new Error(`invalid regular expression: ${PATTERN}`), {
        response: { errors: [{ message: `invalid regular expression: ${PATTERN}`, extensions: { code: 'BAD_USER_INPUT' } }] },
        request: { variables: { query: PATTERN } },
      });
    });
    const r = await call('page', `?offset=0&mode=regex&q=${encodeURIComponent(PATTERN)}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ invalid: true });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(JSON.stringify(warn.mock.calls.map((c) => c.map((a) => (a instanceof Error ? [a.name, a.message, a.stack] : a))))).not.toContain('SECRET');
  });

  it('a server timeout in regex mode is a retryable failure, never an empty result or an invalid pattern', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === MEMORY_SCOPE_QUERY) return { memory: { id: MEM } };
      throw Object.assign(new Error('canceling statement due to statement timeout'), { response: { errors: [{ message: 'timeout', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    });
    const r = await call('page', `?offset=0&mode=regex&q=${encodeURIComponent(PATTERN)}`);
    expect(r.body).toEqual({ failed: true });
  });

  it('an unreadable memory answers the same empty page for a regex search and reads nothing', async () => {
    serve({ readable: false });
    const r = await call('page', '?offset=0&mode=regex&q=a');
    expect(r.body).toEqual({ rows: [], hasMore: false });
    expect(docs()).toEqual([MEMORY_SCOPE_QUERY]);
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
