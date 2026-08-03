/**
 * #374 — loader-side wikilink resolution (spec cor:urn:020:01).
 *
 * The load-bearing rule here is the scope of a BARE `[[loc]]`: the containing
 * node's own memory, never "some memory that happens to have this loc". That's
 * the same footgun hadron-server#335 fixed for `Query.node(loc:)`, so it gets
 * the same treatment the breadcrumb got in #234 — resolve against the memory's
 * own node list, not a global lookup.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { resolveWikilinks } from './wikilinks';

const MEM = 'mem-A';
const MEM_URN = 'hrn:memory:hadronmemory.com::hadron-portal';

const nodes = [
  { id: 'n1', memoryId: MEM, loc: 'findings:x', name: 'Finding X' },
  { id: 'n2', memoryId: MEM, loc: 'glossary:ns1', name: 'Nameserver 1' },
  // A same-loc row from ANOTHER memory, as it would look if a caller ever
  // handed us an unfiltered list. It must never win.
  { id: 'foreign', memoryId: 'mem-B', loc: 'findings:x', name: 'Foreign X' },
];

const noClient = { request: vi.fn() };

function ctx() {
  return { memoryId: MEM, memoryUrn: MEM_URN, nodes };
}

describe('resolveWikilinks — same-memory (bare loc)', () => {
  it('resolves a bare loc against this memory and labels it with the node name', async () => {
    const links = await resolveWikilinks(noClient, ['see [[findings:x]]'], ctx());
    expect(links).toEqual({
      'findings:x': { href: `/app/memories/${MEM}/nodes/n1`, label: 'Finding X' },
    });
    expect(noClient.request).not.toHaveBeenCalled();
  });

  it('never resolves a bare loc to a same-loc node in another memory (#335 scope)', async () => {
    const links = await resolveWikilinks(noClient, ['[[findings:x]]'], ctx());
    expect(links['findings:x']?.href).toContain('/nodes/n1');
    expect(links['findings:x']?.href).not.toContain('foreign');
  });

  it('marks a bare loc with no node in this memory as unresolved', async () => {
    const links = await resolveWikilinks(noClient, ['[[findings:portal-never-written]]'], ctx());
    expect(links['findings:portal-never-written']).toBeNull();
  });

  it('treats a fully-qualified target naming THIS memory as local (no round-trip)', async () => {
    const client = { request: vi.fn() };
    const links = await resolveWikilinks(
      client,
      ['[[hadronmemory.com::hadron-portal::glossary:ns1]]'],
      ctx(),
    );
    expect(links['hadronmemory.com::hadron-portal::glossary:ns1']?.href).toContain('/nodes/n2');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('matches this memory across the legacy single-colon URN grammar', async () => {
    const links = await resolveWikilinks(
      noClient,
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
});

describe('resolveWikilinks — graph fetch failed (nodesFailed)', () => {
  // The layout returns `graphNodes: []` for BOTH an empty memory and a failed
  // graph fetch. Reading the empty list as "no such node" would repaint every
  // valid link as permanent corpus rot on a transient outage. PR #684, Codex P2.
  it('does not mark same-memory links broken when the graph fetch failed', async () => {
    const links = await resolveWikilinks(noClient, ['[[findings:x]]'], {
      memoryId: MEM,
      memoryUrn: MEM_URN,
      nodes: [],
      nodesFailed: true,
    });
    expect(links['findings:x']).toEqual({
      href: '/app/u/hrn:node:hadronmemory.com:hadron-portal:findings:x',
      label: 'findings:x',
    });
  });

  it('still marks them broken for a genuinely empty memory (nodesFailed false)', async () => {
    const links = await resolveWikilinks(noClient, ['[[findings:x]]'], {
      memoryId: MEM,
      memoryUrn: MEM_URN,
      nodes: [],
      nodesFailed: false,
    });
    expect(links['findings:x']).toBeNull();
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

  it('resolves a prefixed v2 target that names THIS memory locally', async () => {
    const client = { request: vi.fn() };
    const links = await resolveWikilinks(
      client,
      ['[[hrn:node:hadronmemory.com:hadron-portal:findings:x]]'],
      ctx(),
    );
    expect(links['hrn:node:hadronmemory.com:hadron-portal:findings:x']?.href).toContain('/nodes/n1');
    expect(client.request).not.toHaveBeenCalled();
  });

  it('gives a bare loc FIRST refusal — a local hit is never reinterpreted as v2 flat', async () => {
    // `findings:x` exists here. Even though a 2-atom loc could never be a v2
    // URN, the ordering is the rule that matters: the spec's bare-loc scope
    // always wins when it resolves. Guarded here with a 3-atom local loc.
    const client = { request: vi.fn() };
    const links = await resolveWikilinks(client, ['[[a:b:c]]'], {
      ...ctx(),
      nodes: [{ id: 'local', memoryId: MEM, loc: 'a:b:c', name: 'Deep Local' }],
    });
    expect(links['a:b:c']).toEqual({ href: `/app/memories/${MEM}/nodes/local`, label: 'Deep Local' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('gives a MISSED bare loc a second chance as an unprefixed v2 flat URN', async () => {
    // The spelling you get by copying a canonical URN and dropping the prefix.
    const request = vi.fn().mockResolvedValue({ w0: { id: 'r1', name: 'R', memoryId: 'mem-R' } });
    const links = await resolveWikilinks(
      { request },
      ['[[hadronmemory.com:dev:findings:a]]'],
      ctx(),
    );
    expect(request.mock.calls[0][1]).toEqual({ r0: 'hrn:node:hadronmemory.com:dev:findings:a' });
    expect(links['hadronmemory.com:dev:findings:a']?.href).toBe('/app/memories/mem-R/nodes/r1');
  });

  it('leaves a missed 2-atom bare loc broken — too short to be a v2 URN', async () => {
    const client = { request: vi.fn() };
    const links = await resolveWikilinks(client, ['[[findings:nope]]'], ctx());
    expect(links['findings:nope']).toBeNull();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('marks a missed deep loc broken when the v2 reading also finds nothing', async () => {
    const request = vi.fn().mockResolvedValue({ w0: null });
    const links = await resolveWikilinks({ request }, ['[[ops:incidents:2026:thing]]'], ctx());
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
    // Composed in grammar v2 (cor:urn:010:01) — flat, single colon.
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

  it('caps the per-page batch and marks the overflow unresolved rather than silently dropping it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = Array.from({ length: 55 }, (_, i) => `[[o::m::loc${i}]]`).join(' ');
    const request = vi.fn().mockResolvedValue({});
    const links = await resolveWikilinks({ request }, [body], ctx());

    expect(Object.keys(request.mock.calls[0][1])).toHaveLength(50);
    expect(links['o::m::loc54']).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds the 50 per-page cap'));
    warn.mockRestore();
  });
});
