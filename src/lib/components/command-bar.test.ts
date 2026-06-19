import { describe, it, expect, vi } from 'vitest';
import { buildCommandRoute, type UrnResolution } from './command-bar';

// A resolve stub that knows one org + one memory; everything else is "no access".
const resolve = vi.fn(async (urn: string): Promise<UrnResolution | null> => {
  if (urn === 'hrn:org:acme') return { kind: 'org', id: 'org-1', memoryId: null, organizationId: 'org-1' };
  if (urn === 'hrn:memory:acme::docs') return { kind: 'memory', id: 'mem-1', memoryId: 'mem-1', organizationId: 'org-1' };
  return null;
});

describe('buildCommandRoute', () => {
  it('rejects empty input for any mode', async () => {
    expect(await buildCommandRoute('search', '   ', resolve)).toMatchObject({ ok: false });
    expect(await buildCommandRoute('open', '', resolve)).toMatchObject({ ok: false });
  });

  it('search → global search page with the query encoded', async () => {
    expect(await buildCommandRoute('search', 'hello world', resolve)).toEqual({
      ok: true,
      path: '/app/search?q=hello%20world',
    });
  });

  it('open → the /app/u resolver route with the raw URN (no resolve call)', async () => {
    expect(await buildCommandRoute('open', '  hrn:node:acme::docs::intro  ', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:acme::docs::intro',
    });
  });

  it('create org → org-new with the slug prefilled, no parent resolution', async () => {
    expect(await buildCommandRoute('create', 'hrn:org:acme', resolve)).toEqual({
      ok: true,
      path: '/app/orgs/new?urn=acme',
    });
  });

  it('create memory → resolves the owning org, lands on memory-new with slug', async () => {
    expect(await buildCommandRoute('create', 'hrn:memory:acme::docs', resolve)).toEqual({
      ok: true,
      path: '/app/orgs/org-1/memories/new?slug=docs',
    });
  });

  it('create agent → resolves the owning org, lands on agent-new with slug', async () => {
    expect(await buildCommandRoute('create', 'hrn:agent:acme::bot', resolve)).toEqual({
      ok: true,
      path: '/app/orgs/org-1/agents/new?slug=bot',
    });
  });

  it('create node → resolves the memory (path minus last segment), loc = last segment', async () => {
    expect(await buildCommandRoute('create', 'hrn:node:acme::docs::intro:welcome', resolve)).toEqual({
      ok: true,
      path: '/app/memories/mem-1/nodes/new?loc=intro%3Awelcome',
    });
  });

  it('create app → org list (apps are created by installing an agent, spec 009)', async () => {
    expect(await buildCommandRoute('create', 'hrn:app:acme::myapp', resolve)).toEqual({
      ok: true,
      path: '/app/orgs',
    });
  });

  it('create with an unresolvable parent org → inline error, no navigation', async () => {
    const r = await buildCommandRoute('create', 'hrn:memory:ghost::docs', resolve);
    expect(r.ok).toBe(false);
  });

  it('create with a malformed URN → inline parse error', async () => {
    const r = await buildCommandRoute('create', 'not-a-urn', resolve);
    expect(r.ok).toBe(false);
  });
});
