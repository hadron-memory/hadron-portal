/**
 * #374 — loader-side wikilink resolution (spec hrn:node:hadronmemory.com:specs:cor:urn:020:01).
 *
 * The load-bearing rule here is the scope of a BARE `[[loc]]`: the containing
 * node's own memory, never "some memory that happens to have this loc". That's
 * the same footgun hadron-server#335 fixed for `Query.node(loc:)`, so a bare
 * loc is looked up as THIS memory's node URN (the server pins the memory).
 *
 * portal#1433: every target is looked up through the server now; the memory
 * layout no longer ships the node list a bare loc used to resolve against. The
 * `serve` client below stands in for the server: it answers the same-memory
 * `nodeBatch(refs:)` and each aliased cross-memory `node(ref: <urn>)` from a
 * table keyed by full node URN, so what the tests pin is which URN a link asks
 * for and what it does with the answer.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { resolveWikilinks } from './wikilinks';
import { WIKILINK_TARGETS_BATCH_QUERY } from './queries';

const MEM = 'mem-A';
const MEM_URN = 'hrn:memory:hadronmemory.com::hadron-portal';
const NODE_URN = (loc: string) => `hrn:node:hadronmemory.com:hadron-portal:${loc}`;

const table: Record<string, { id: string; name: string | null; memoryId: string }> = {
  [NODE_URN('findings:x')]: { id: 'n1', name: 'Finding X', memoryId: MEM },
  [NODE_URN('glossary:ns1')]: { id: 'n2', name: 'Nameserver 1', memoryId: MEM },
};

/**
 * A stub server: answers a `nodeBatch` with the rows at its `refs` (the loc is
 * the URN's tail after `hrn:node:<org>:<memory>:`), and each `w{i}` alias from
 * `table` by the URN in `r{i}`.
 */
function serve(rows: typeof table = table) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub for the overloaded client.request
    request: vi.fn(async (...args: any[]) => {
      if (args[0] === WIKILINK_TARGETS_BATCH_QUERY) {
        const refs = (args[1]?.refs ?? []) as string[];
        const nodes = refs.flatMap((r) => (rows[r] ? [{ ...rows[r], loc: r.split(':').slice(4).join(':') }] : []));
        return { nodeBatch: { nodes, unavailable: [], omitted: [], truncated: false } };
      }
      const vars = (args[1] ?? {}) as Record<string, string>;
      return Object.fromEntries(Object.keys(vars).map((k, i) => [`w${i}`, rows[vars[k]] ?? null]));
    }),
  };
}

function ctx() {
  return { memoryId: MEM, memoryUrn: MEM_URN };
}

describe('resolveWikilinks — same-memory (bare loc)', () => {
  it('looks a bare loc up as THIS memory\'s node URN and labels it with the node name', async () => {
    const client = serve();
    const links = await resolveWikilinks(client, ['see [[findings:x]]'], ctx());
    expect(client.request.mock.calls[0]).toEqual([WIKILINK_TARGETS_BATCH_QUERY, { refs: [NODE_URN('findings:x')] }]);
    expect(links).toEqual({
      'findings:x': { href: `/app/memories/${MEM}/nodes/n1`, label: 'Finding X' },
    });
  });

  it('asks for this memory, never a same-loc node in another memory (#335 scope)', async () => {
    // A foreign memory holding the same loc is a different URN: the bare loc
    // is only ever composed against this memory.
    const client = serve({
      ...table,
      'hrn:node:other.test:foreign:findings:x': { id: 'foreign', name: 'Foreign X', memoryId: 'mem-B' },
    });
    const links = await resolveWikilinks(client, ['[[findings:x]]'], ctx());
    expect(links['findings:x']?.href).toContain('/nodes/n1');
    expect(links['findings:x']?.href).not.toContain('foreign');
  });

  it('marks a bare loc with no node in this memory as unresolved', async () => {
    const links = await resolveWikilinks(serve(), ['[[findings:portal-never-written]]'], ctx());
    expect(links['findings:portal-never-written']).toBeNull();
  });

  it('treats a fully-qualified target naming THIS memory as local, in the same lookup', async () => {
    const client = serve();
    const links = await resolveWikilinks(
      client,
      ['[[hadronmemory.com::hadron-portal::glossary:ns1]]'],
      ctx(),
    );
    expect(links['hadronmemory.com::hadron-portal::glossary:ns1']?.href).toContain('/nodes/n2');
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('matches this memory across the legacy single-colon URN grammar', async () => {
    const links = await resolveWikilinks(
      serve(),
      ['[[hadronmemory.com::hadron-portal::findings:x]]'],
      { ...ctx(), memoryUrn: 'hadronmemory.com:hadron-portal' },
    );
    expect(links['hadronmemory.com::hadron-portal::findings:x']?.href).toContain('/nodes/n1');
  });

  it('returns an empty map (and makes no request) for a body with no wikilinks', async () => {
    const client = { request: vi.fn() };
    expect(await resolveWikilinks(client, ['plain prose', null], ctx())).toEqual({});
    expect(client.request).not.toHaveBeenCalled();
  });

  it('cannot address a same-memory target without the memory URN: unresolved, no request', async () => {
    const client = { request: vi.fn() };
    const links = await resolveWikilinks(client, ['[[findings:x]]'], { memoryId: MEM, memoryUrn: null });
    expect(links['findings:x']).toBeNull();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('does not mark same-memory links broken when the lookup itself failed', async () => {
    // A transient outage must not repaint every valid link as corpus rot
    // (PR #684 review, Codex P2): fall back to the resolver route.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = { request: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const links = await resolveWikilinks(client, ['[[findings:x]]'], ctx());
    expect(links['findings:x']).toEqual({ href: `/app/u/${NODE_URN('findings:x')}`, label: 'findings:x' });
  });

  /** A batch the server cut at its response-size cap: `omitted` refs were readable but dropped. */
  function serveTruncated(answer: { nodes: string[]; omitted: string[]; unavailable: string[] }) {
    return {
      request: vi.fn(async () => ({
        nodeBatch: {
          nodes: answer.nodes.map((urn) => ({ ...table[urn], loc: urn.split(':').slice(4).join(':') })),
          omitted: answer.omitted,
          unavailable: answer.unavailable,
          truncated: true,
        },
      })),
    };
  }

  it('renders a size-OMITTED target unchecked, never as a missing node (#1438 LOCAL P2)', async () => {
    // nodeBatch's byte cap counts content before projection, so even this thin
    // selection can be truncated; an omitted ref exists and is readable.
    const client = serveTruncated({ nodes: [NODE_URN('findings:x')], omitted: [NODE_URN('findings:big')], unavailable: [] });
    const links = await resolveWikilinks(client, ['[[findings:x]] [[findings:big]]'], ctx());
    expect(links['findings:x']?.href).toBe(`/app/memories/${MEM}/nodes/n1`);
    expect(links['findings:big']).toEqual({ href: `/app/u/${NODE_URN('findings:big')}`, label: 'findings:big' });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('still marks an UNAVAILABLE target missing when the batch was also truncated', async () => {
    const client = serveTruncated({
      nodes: [],
      omitted: [NODE_URN('findings:big')],
      unavailable: [NODE_URN('findings:never-written')],
    });
    const links = await resolveWikilinks(client, ['[[findings:big]] [[findings:never-written]]'], ctx());
    expect(links['findings:big']?.href).toBe(`/app/u/${NODE_URN('findings:big')}`);
    expect(links['findings:never-written']).toBeNull();
  });

  it('resolves many same-memory links in ONE nodeBatch (up to its 200 cap)', async () => {
    const rows: typeof table = {};
    const locs = Array.from({ length: 120 }, (_, i) => `bulk:n${i}`);
    for (const [i, loc] of locs.entries()) rows[NODE_URN(loc)] = { id: `id${i}`, name: `N${i}`, memoryId: MEM };
    const client = serve(rows);
    const links = await resolveWikilinks(client, [locs.map((l) => `[[${l}]]`).join(' ')], ctx());
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(Object.values(links).every((l) => l !== null)).toBe(true);
    expect(links['bulk:n119']?.href).toBe(`/app/memories/${MEM}/nodes/id119`);
  });
});

describe('resolveWikilinks — grammar v2 (cor:urn:010:01)', () => {
  it('resolves an explicitly-prefixed v2 flat cross-memory target', async () => {
    const request = vi.fn().mockResolvedValue({ w0: { id: 'r1', name: 'R', memoryId: 'mem-R' } });
    const links = await resolveWikilinks(
      { request },
      ['[[hrn:node:hadronmemory.com:dev:findings:a]]'],
      ctx(),
    );
    expect(request.mock.calls[0][1]).toEqual({ r0: 'hrn:node:hadronmemory.com:dev:findings:a' });
    expect(links['hrn:node:hadronmemory.com:dev:findings:a']?.href).toBe(
      '/app/memories/mem-R/nodes/r1',
    );
  });

  it('resolves a prefixed v2 target that names THIS memory', async () => {
    const client = serve();
    const links = await resolveWikilinks(
      client,
      ['[[hrn:node:hadronmemory.com:hadron-portal:findings:x]]'],
      ctx(),
    );
    expect(links['hrn:node:hadronmemory.com:hadron-portal:findings:x']?.href).toContain('/nodes/n1');
  });

  it('gives a bare loc FIRST refusal — a local hit is never reinterpreted as v2 flat', async () => {
    // bare-loc-ok — a loc shape being described, not a citation.
    // A 3-atom bare loc could also read as a v2 flat URN. The spec's bare-loc
    // scope always wins when it resolves: one request, for THIS memory's URN.
    const client = serve({ [NODE_URN('a:b:c')]: { id: 'local', name: 'Deep Local', memoryId: MEM } });
    const links = await resolveWikilinks(client, ['[[a:b:c]]'], ctx());
    expect(links['a:b:c']).toEqual({ href: `/app/memories/${MEM}/nodes/local`, label: 'Deep Local' });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('gives a MISSED bare loc a second chance as an unprefixed v2 flat URN', async () => {
    // The spelling you get by copying a canonical URN and dropping the prefix.
    const flatUrn = 'hrn:node:hadronmemory.com:dev:findings:a';
    const client = serve({ [flatUrn]: { id: 'r1', name: 'R', memoryId: 'mem-R' } });
    const links = await resolveWikilinks(client, ['[[hadronmemory.com:dev:findings:a]]'], ctx());
    // First this memory's reading (a miss), then the flat reading.
    expect(client.request.mock.calls.map((c) => c[1])).toEqual([
      { refs: [NODE_URN('hadronmemory.com:dev:findings:a')] },
      { r0: flatUrn },
    ]);
    expect(links['hadronmemory.com:dev:findings:a']?.href).toBe('/app/memories/mem-R/nodes/r1');
  });

  it('leaves a missed 2-atom bare loc broken — too short to be a v2 URN', async () => {
    const client = serve();
    const links = await resolveWikilinks(client, ['[[findings:nope]]'], ctx());
    expect(links['findings:nope']).toBeNull();
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('marks a missed deep loc broken when the v2 reading also finds nothing', async () => {
    const links = await resolveWikilinks(serve(), ['[[ops:incidents:2026:thing]]'], ctx());
    expect(links['ops:incidents:2026:thing']).toBeNull();
  });
});

describe('resolveWikilinks — cross-memory', () => {
  it('batches cross-memory targets into ONE aliased node(ref:) request', async () => {
    const request = vi.fn().mockResolvedValue({
      w0: { id: 'r1', name: 'Remote One', memoryId: 'mem-R' },
      w1: null,
    });
    const links = await resolveWikilinks(
      { request },
      ['[[hadronmemory.com::dev::findings:a]] and [[hadronmemory.com::dev::findings:b]]'],
      ctx(),
    );

    expect(request).toHaveBeenCalledTimes(1);
    const [doc, vars] = request.mock.calls[0];
    expect(doc).toContain('w0: node(ref: $r0, raw: true)');
    expect(doc).toContain('w1: node(ref: $r1, raw: true)');
    // raw: true keeps this a metadata lookup — without it the server
    // Mustache-compiles every target's content on read (PR #684 review).
    // The full node URN is passed as a variable, never interpolated into the
    // document — authored content must not reach the GraphQL parser as syntax.
    // Composed in grammar v2 (hrn:node:hadronmemory.com:specs:cor:urn:010:01) — flat, single colon.
    expect(vars).toEqual({
      r0: 'hrn:node:hadronmemory.com:dev:findings:a',
      r1: 'hrn:node:hadronmemory.com:dev:findings:b',
    });

    expect(links['hadronmemory.com::dev::findings:a']).toEqual({
      href: '/app/memories/mem-R/nodes/r1',
      label: 'Remote One',
    });
    expect(links['hadronmemory.com::dev::findings:b']).toBeNull();
  });

  it('marks an uncomposable target unresolved without failing the batch', async () => {
    // A wrong-type URN prefix can't be composed into a node URN at all.
    // That's an unresolved reference — keep it out of the batch instead of
    // letting the throw take the whole page down.
    const request = vi.fn().mockResolvedValue({ w0: { id: 'r1', name: 'R', memoryId: 'mem-R' } });
    const links = await resolveWikilinks(
      { request },
      ['[[hrn:org:x::conventions:y]] [[hadronmemory.com::dev::findings:a]]'],
      ctx(),
    );
    expect(links['hrn:org:x::conventions:y']).toBeNull();
    expect(links['hadronmemory.com::dev::findings:a']).not.toBeNull();
    expect(request.mock.calls[0][1]).toEqual({
      r0: 'hrn:node:hadronmemory.com:dev:findings:a',
    });
  });

  it('shows the org-less memory URN the corpus sweep found as broken, not as a crash', async () => {
    // `[[hadron-server::conventions:…]]` — missing the org segment. It composes
    // fine (it's a plausible slug-path), so the server is what says "no such
    // node", and the reader sees the gap.
    const request = vi.fn().mockResolvedValue({ w0: null });
    const links = await resolveWikilinks({ request }, ['[[hadron-server::conventions:x]]'], ctx());
    expect(links['hadron-server::conventions:x']).toBeNull();
  });

  it('uses the partial data from a ClientError so one bad alias does not blank the rest', async () => {
    const err = new ClientError(
      {
        data: { w0: { id: 'r1', name: 'R', memoryId: 'mem-R' }, w1: null },
        errors: [],
        status: 200,
        headers: new Headers(),
      } as unknown as ConstructorParameters<typeof ClientError>[0],
      { query: '' },
    );
    const request = vi.fn().mockRejectedValue(err);
    const links = await resolveWikilinks(
      { request },
      ['[[o::m::a]] [[o::m::b]]'],
      ctx(),
    );
    expect(links['o::m::a']).toEqual({ href: '/app/memories/mem-R/nodes/r1', label: 'R' });
    expect(links['o::m::b']).toBeNull();
  });

  it('falls back to the /app/u/<urn> resolver — not a broken marker — on a total failure', async () => {
    // A portal-side outage is not evidence that the corpus rotted. Claiming a
    // link is broken when we simply could not check is the worse error.
    const request = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const links = await resolveWikilinks({ request }, ['[[o::m::findings:a]]'], ctx());
    expect(links['o::m::findings:a']).toEqual({
      href: '/app/u/hrn:node:o:m:findings:a',
      label: 'findings:a',
    });
  });

  it('caps the per-page batch and renders the overflow UNCHECKED, never as a missing node', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = Array.from({ length: 205 }, (_, i) => `[[o::m::loc${i}]]`).join(' ');
    const request = vi.fn().mockResolvedValue({});
    const links = await resolveWikilinks({ request }, [body], ctx());

    expect(Object.keys(request.mock.calls[0][1])).toHaveLength(50);
    // Not read is not "no node": the resolver route re-checks on click.
    expect(links['o::m::loc204']).toEqual({ href: '/app/u/hrn:node:o:m:loc204', label: 'loc204' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds the 200 per-page cap'));
    warn.mockRestore();
  });
});
