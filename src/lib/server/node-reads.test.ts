import { describe, expect, it, vi } from 'vitest';
import { loadAncestors, ancestorLocs, NODE_BATCH_MAX_REFS } from './breadcrumb-ancestors';
import { loadChildren, orderChildren } from './node-children';
import { serveMemoryReads, type SeedNode } from '$lib/test/serveMemoryReads';
import { NODE_ANCESTORS_QUERY, NODE_CHILDREN_QUERY, MEMORY_NODES_QUERY, MEMORY_EDGES_QUERY } from './queries';

// portal#1433 pins: the node page's breadcrumb, children and siblings used to be
// computed in memory over the layout's whole node list. The ORACLE below is
// that old in-memory code, embedded verbatim, run on the same seeded memory;
// the new server-backed reads must give the same answer.
const MEM = { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' };

const seeded: SeedNode[] = [
  { id: 'a', loc: 'specs', name: 'Specs' },
  { id: 'b', loc: 'specs:auth', name: 'Auth' },
  { id: 'c', loc: 'specs:auth:jwt', name: 'JWT', seq: 2 },
  { id: 'd', loc: 'specs:auth:oauth', name: 'OAuth', seq: 1 },
  { id: 'e', loc: 'specs:auth:basic', name: 'Basic' },
  { id: 'f', loc: 'specs:auth:alpha', name: 'Alpha' },
  { id: 'g', loc: 'specs:auth:jwt:keys', name: 'Keys' },
  { id: 'h', loc: 'other', name: 'Other' },
  { id: 'i', loc: 'specs:billing', name: 'Billing', memoryId: 'mem-2' },
];

// ORACLE — the old node-page code (children), over the layout's graphNodes.
function oldChildren(graphNodes: SeedNode[], loc: string) {
  return graphNodes
    .filter((n) => (n.memoryId ?? MEM.id) === MEM.id)
    .filter((n) => {
      if (n.loc === loc) return false;
      if (!n.loc.startsWith(loc + ':')) return false;
      return !n.loc.slice(loc.length + 1).includes(':');
    })
    .map((n) => ({ ...n, seq: n.seq ?? null }))
    .sort((a, b) => {
      if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
      if (a.seq !== null) return -1;
      if (b.seq !== null) return 1;
      return a.loc.localeCompare(b.loc);
    })
    .map((n) => n.id);
}

function client(rows: SeedNode[]) {
  const reads = serveMemoryReads(rows, MEM);
  return { request: vi.fn(async (doc: string, vars?: Record<string, unknown>) => reads(doc, vars)) } as never;
}

describe('children read equals the old in-memory result (Order A)', () => {
  it.each(['specs', 'specs:auth', 'specs:auth:jwt', 'other', 'nothing:here'])('children of %s', async (loc) => {
    const got = (await loadChildren(client(seeded), MEM, loc)).map((n) => n.id);
    expect(got).toEqual(oldChildren(seeded, loc));
  });

  it('orders seq first (ascending), then loc — and re-asserts it if the server drifts', () => {
    const shuffled = [
      { seq: null, loc: 'b' }, { seq: 2, loc: 'z' }, { seq: null, loc: 'a' }, { seq: 1, loc: 'y' },
    ];
    expect(orderChildren(shuffled).map((n) => n.loc)).toEqual(['y', 'z', 'a', 'b']);
  });

  it('the roots (parentLoc "") are the siblings of a new top-level node', async () => {
    const roots = (await loadChildren(client(seeded), MEM, '')).map((n) => n.id);
    expect(roots).toEqual(['h', 'a']); // 'other' before 'specs'; mem-2's rows are not this memory's
  });

  it('asks for the children of that loc in THIS memory only, and issues no graph request', async () => {
    const c = client(seeded);
    await loadChildren(c, MEM, 'specs:auth');
    const calls = (c as unknown as { request: ReturnType<typeof vi.fn> }).request.mock.calls;
    expect(calls.every(([doc]) => doc === NODE_CHILDREN_QUERY)).toBe(true);
    expect(calls[0][1]).toMatchObject({ memoryIds: ['mem-1'], childrenOf: 'specs:auth' });
    const docs = calls.map(([doc]) => doc);
    expect(docs).not.toContain(MEMORY_NODES_QUERY);
    expect(docs).not.toContain(MEMORY_EDGES_QUERY);
  });

  it('drains every page: a server that returns 500 at a time loses nothing', async () => {
    const many: SeedNode[] = Array.from({ length: 1203 }, (_, i) => ({ id: `n${i}`, loc: `p:c${String(i).padStart(4, '0')}` }));
    const reads = serveMemoryReads(many, MEM);
    const request = vi.fn(async (doc: string, vars?: Record<string, unknown>) => {
      const all = (reads(doc, { ...vars, offset: 0 }) as { findNodes: { hits: unknown[] } }).findNodes.hits;
      const off = Number(vars?.offset ?? 0);
      return { findNodes: { hits: all.slice(off, off + Number(vars?.limit ?? 500)) } };
    });
    const got = await loadChildren({ request } as never, MEM, 'p');
    expect(got).toHaveLength(1203);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('breadcrumb ancestors equal the old in-memory lookup', () => {
  // ORACLE — the old map lookup by loc over the same-memory graphNodes.
  const oldAncestors = (loc: string) =>
    new Map(ancestorLocs(loc).flatMap((l) => {
      const hit = seeded.find((n) => n.loc === l && (n.memoryId ?? MEM.id) === MEM.id);
      return hit ? [[l, { id: hit.id, name: hit.name }] as const] : [];
    }));

  it.each(['specs:auth:jwt:keys', 'specs:billing:x', 'other:deep:leaf'])('%s', async (loc) => {
    const got = await loadAncestors(client(seeded), MEM, loc);
    const want = oldAncestors(loc);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [l, w] of want) expect(got.get(l)).toMatchObject(w);
  });

  it('a foreign-memory node at an ancestor loc lends neither id nor name (#234) even from a leaky server', async () => {
    const reads = serveMemoryReads(seeded, MEM, { leakForeign: true });
    const leaky = { request: vi.fn(async (d: string, v?: Record<string, unknown>) => reads(d, v)) } as never;
    const got = await loadAncestors(leaky, MEM, 'specs:billing:x');
    expect(got.get('specs:billing')).toBeUndefined();
  });

  it('reads a loc deeper than the nodeBatch cap in chunks, never one oversized call', async () => {
    const depth = NODE_BATCH_MAX_REFS * 2 + 50;
    const loc = Array.from({ length: depth + 1 }, (_, i) => `s${i}`).join(':');
    const rows: SeedNode[] = ancestorLocs(loc).map((l, i) => ({ id: `x${i}`, loc: l }));
    const c = client(rows);
    const got = await loadAncestors(c, MEM, loc);
    expect(got.size).toBe(depth);
    const calls = (c as unknown as { request: ReturnType<typeof vi.fn> }).request.mock.calls;
    expect(calls.every(([doc]) => doc === NODE_ANCESTORS_QUERY)).toBe(true);
    expect(calls).toHaveLength(3);
    for (const [, vars] of calls) expect((vars as { refs: string[] }).refs.length).toBeLessThanOrEqual(NODE_BATCH_MAX_REFS);
  });
});
