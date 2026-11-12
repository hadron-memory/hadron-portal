import { describe, expect, it, vi } from 'vitest';
import { loadAncestors, ancestorLocs, NODE_BATCH_MAX_REFS } from './breadcrumb-ancestors';
import { resolveWikilinks } from './wikilinks';
import { serveMemoryReads, type SeedNode } from '$lib/test/serveMemoryReads';
import { resolveWikilinks as oldResolveWikilinks } from '$lib/test/oracle/wikilinks-pre-1527';
import { NODE_ANCESTORS_QUERY, WIKILINK_TARGETS_BATCH_QUERY, MEMORY_NODES_QUERY, MEMORY_EDGES_QUERY } from './queries';

// portal#1433 pins. Before #1527 the node page computed its breadcrumb and
// wikilinks in memory over the layout's whole node list. The ORACLE is that
// code as it stood at 3b333cf0^ (`$lib/test/oracle/*-pre-1527`), run on the
// same seeded memory; the bounded server reads must give the same answer.
const MEM = { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' };

const seeded: SeedNode[] = [
  { id: 'a', loc: 'specs', name: 'Specs' },
  { id: 'b', loc: 'specs:auth', name: 'Auth' },
  { id: 'c', loc: 'specs:auth:jwt', name: 'JWT', seq: 2 },
  { id: 'd', loc: 'specs:auth:oauth', name: 'OAuth', seq: 1 },
  { id: 'g', loc: 'specs:auth:jwt:keys', name: 'Keys' },
  { id: 'u', loc: 'specs:unnamed', name: null },
  { id: 'h', loc: 'other', name: 'Other' },
  { id: 'i', loc: 'specs:billing', name: 'Billing', memoryId: 'mem-2' },
];

/** The old layout's `graphNodes`: this memory's rows, as the drain returned them. */
const graphNodes = seeded
  .filter((n) => (n.memoryId ?? MEM.id) === MEM.id)
  .map((n) => ({ id: n.id, memoryId: MEM.id, loc: n.loc, name: n.name ?? null }));

function client(rows: SeedNode[], opts: { leakForeign?: boolean } = {}) {
  const reads = serveMemoryReads(rows, MEM, opts);
  const request = vi.fn(async (doc: string, vars?: Record<string, unknown>) => {
    const served = reads(doc, vars);
    if (served === undefined) throw new Error(`unexpected request: ${doc.slice(0, 40)}`);
    return served;
  });
  return { request } as unknown as { request: typeof request } & Parameters<typeof loadAncestors>[0];
}

describe('breadcrumb ancestors equal the old in-memory lookup', () => {
  // ORACLE: the old map lookup by loc over the same-memory graphNodes.
  const oldAncestors = (loc: string) =>
    new Map(ancestorLocs(loc).flatMap((l) => {
      const hit = graphNodes.find((n) => n.loc === l);
      return hit ? [[l, { id: hit.id, name: hit.name }] as const] : [];
    }));

  it.each(['specs:auth:jwt:keys', 'specs:billing:x', 'other:deep:leaf', 'specs:unnamed:x'])('%s', async (loc) => {
    const { byLoc, known } = await loadAncestors(client(seeded), MEM, loc);
    const want = oldAncestors(loc);
    expect([...byLoc.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [l, w] of want) expect(byLoc.get(l)).toMatchObject(w);
    expect(known).toBe(true);
  });

  it('a top-level loc has no ancestors and needs no request', async () => {
    const c = client(seeded);
    expect(await loadAncestors(c, MEM, 'specs')).toEqual({ byLoc: new Map(), known: true });
    expect(c.request).not.toHaveBeenCalled();
  });

  it('a foreign-memory node at an ancestor loc lends neither id nor name (#234) even from a leaky server', async () => {
    const { byLoc } = await loadAncestors(client(seeded, { leakForeign: true }), MEM, 'specs:billing:x');
    expect(byLoc.get('specs:billing')).toBeUndefined();
  });

  it('reads a loc deeper than the nodeBatch cap in chunks, never one oversized call', async () => {
    const depth = NODE_BATCH_MAX_REFS * 2 + 50;
    const loc = Array.from({ length: depth + 1 }, (_, i) => `s${i}`).join(':');
    const rows: SeedNode[] = ancestorLocs(loc).map((l, i) => ({ id: `x${i}`, loc: l }));
    const c = client(rows);
    const { byLoc, known } = await loadAncestors(c, MEM, loc);
    expect(byLoc.size).toBe(depth);
    expect(known).toBe(true);
    const calls = c.request.mock.calls;
    expect(calls.every(([doc]) => doc === NODE_ANCESTORS_QUERY)).toBe(true);
    expect(calls).toHaveLength(3);
    for (const [, vars] of calls) expect((vars as { refs: string[] }).refs.length).toBeLessThanOrEqual(NODE_BATCH_MAX_REFS);
  });

  it('a failed read is not "known": the page must not offer to create the unlooked-up crumbs', async () => {
    const failing = { request: vi.fn(async () => { throw new Error('boom'); }) };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { byLoc, known } = await loadAncestors(failing, MEM, 'specs:auth:jwt');
    expect(byLoc.size).toBe(0);
    expect(known).toBe(false);
  });

  it('a truncated batch is not "known"', async () => {
    const truncating = { request: vi.fn(async () => ({ nodeBatch: { nodes: [], unavailable: [], omitted: [], truncated: true } })) };
    expect((await loadAncestors(truncating, MEM, 'specs:auth:jwt')).known).toBe(false);
  });

  it('an answer listing omitted ancestors is not "known", even without the truncated flag (#1438 BLIND P2)', async () => {
    const omitting = {
      request: vi.fn(async () => ({
        nodeBatch: { nodes: [], unavailable: [], omitted: ['hrn:node:x.test:m:specs'], truncated: false },
      })),
    };
    expect((await loadAncestors(omitting, MEM, 'specs:auth:jwt')).known).toBe(false);
  });

  it('without the memory URN nothing can be addressed: no request, not "known"', async () => {
    const c = client(seeded);
    expect(await loadAncestors(c, { id: MEM.id, urn: null }, 'specs:auth:jwt')).toEqual({ byLoc: new Map(), known: false });
    expect(c.request).not.toHaveBeenCalled();
  });
});

describe('wikilinks equal the old in-memory resolver (3b333cf0^)', () => {
  const bodies = [
    'see [[specs:auth]] and [[specs:auth:jwt|the JWT spec]]',
    'a dangling [[specs:never-written]], an unnamed [[specs:unnamed]]',
    'a foreign-only loc [[specs:billing]], and [[other]] again [[other]]',
  ];

  it.each(bodies)('%s', async (body) => {
    const fresh = await resolveWikilinks(client(seeded), [body], { memoryId: MEM.id, memoryUrn: MEM.urn });
    const old = await oldResolveWikilinks(client(seeded), [body], {
      memoryId: MEM.id, memoryUrn: MEM.urn, nodes: graphNodes, nodesFailed: false,
    });
    expect(fresh).toEqual(old);
  });

  it('resolves same-memory targets with ONE nodeBatch and no graph request', async () => {
    const c = client(seeded);
    await resolveWikilinks(c, [bodies[0], bodies[2]], { memoryId: MEM.id, memoryUrn: MEM.urn });
    const docs = c.request.mock.calls.map(([doc]) => doc);
    expect(docs).toEqual([WIKILINK_TARGETS_BATCH_QUERY]);
    expect(docs).not.toContain(MEMORY_NODES_QUERY);
    expect(docs).not.toContain(MEMORY_EDGES_QUERY);
  });

  it('a failed read renders like the old nodesFailed path (unchecked), never "no node"', async () => {
    const failing = { request: vi.fn(async () => { throw new Error('boom'); }) };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fresh = await resolveWikilinks(failing, [bodies[0]], { memoryId: MEM.id, memoryUrn: MEM.urn });
    const old = await oldResolveWikilinks(failing, [bodies[0]], {
      memoryId: MEM.id, memoryUrn: MEM.urn, nodes: [], nodesFailed: true,
    });
    expect(fresh).toEqual(old);
    for (const v of Object.values(fresh)) expect(v).not.toBeNull();
  });

  it('over the 200 cap, the rest render unchecked, never "no node"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = Array.from({ length: 205 }, (_, i) => `[[p:n${i}]]`).join(' ');
    const c = client([]);
    const links = await resolveWikilinks(c, [body], { memoryId: MEM.id, memoryUrn: MEM.urn });
    const calls = c.request.mock.calls.filter(([doc]) => doc === WIKILINK_TARGETS_BATCH_QUERY);
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { refs: string[] }).refs).toHaveLength(200);
    for (let i = 200; i < 205; i++) expect(links[`p:n${i}`]?.href).toMatch(/^\/app\/u\//);
    // The 200 that WERE read and missed are the only "no node" claims.
    expect(links['p:n0']).toBeNull();
  });
});
