import { describe, it, expect, vi } from 'vitest';
import {
  COMMAND_MODES,
  acceptCompletion,
  buildCommandRoute,
  completeCommand,
  parseCommandInput,
  type UrnResolution,
} from './command-bar';

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

describe('COMMAND_MODES registry', () => {
  it('every command carries a tint (the command↔color register)', () => {
    for (const m of COMMAND_MODES) expect(m.tint).toBeTruthy();
  });

  it('tints are distinct so each command reads as a different color', () => {
    const tints = COMMAND_MODES.map((m) => m.tint);
    expect(new Set(tints).size).toBe(tints.length);
  });
});

describe('completeCommand', () => {
  it('returns null for an empty / whitespace-only token', () => {
    expect(completeCommand('')).toBeNull();
    expect(completeCommand('   ')).toBeNull();
  });

  it('completes a unique prefix, suffix = the remaining letters', () => {
    expect(completeCommand('o')).toEqual({ id: 'open', completion: 'pen' });
    expect(completeCommand('op')).toEqual({ id: 'open', completion: 'en' });
    expect(completeCommand('s')).toEqual({ id: 'search', completion: 'earch' });
    expect(completeCommand('c')).toEqual({ id: 'create', completion: 'reate' });
  });

  it('an exact id returns an empty completion (still a match)', () => {
    expect(completeCommand('open')).toEqual({ id: 'open', completion: '' });
  });

  it('is case-insensitive and trims', () => {
    expect(completeCommand('  OP ')).toEqual({ id: 'open', completion: 'en' });
  });

  it('returns null for a token that matches no command', () => {
    expect(completeCommand('x')).toBeNull();
    expect(completeCommand('zzz')).toBeNull();
  });
});

describe('acceptCompletion', () => {
  it('expands a partial command to the canonical word + a trailing space', () => {
    expect(acceptCompletion('o')).toBe('open ');
    expect(acceptCompletion('op')).toBe('open ');
    expect(acceptCompletion('s')).toBe('search ');
    expect(acceptCompletion('OPEN')).toBe('open '); // canonicalizes case
  });

  it('a full command word still gains its trailing space', () => {
    expect(acceptCompletion('create')).toBe('create ');
  });

  it('returns null once a separating space exists (command word locked)', () => {
    expect(acceptCompletion('open ')).toBeNull();
    expect(acceptCompletion('open hrn:node:acme::docs::intro')).toBeNull();
  });

  it('returns null for an unknown or empty token', () => {
    expect(acceptCompletion('x')).toBeNull();
    expect(acceptCompletion('')).toBeNull();
    expect(acceptCompletion('   ')).toBeNull();
  });
});

describe('parseCommandInput', () => {
  it('no separator yet → token is the whole (left-trimmed) value, no arg', () => {
    expect(parseCommandInput('op')).toEqual({ mode: null, token: 'op', arg: '' });
    expect(parseCommandInput('open')).toEqual({ mode: 'open', token: 'open', arg: '' });
  });

  it('splits command word from argument on the first whitespace run', () => {
    expect(parseCommandInput('open hrn:node:acme::docs::intro')).toEqual({
      mode: 'open',
      token: 'open',
      arg: 'hrn:node:acme::docs::intro',
    });
  });

  it('preserves the argument’s own internal spaces (search phrase)', () => {
    expect(parseCommandInput('search hello world')).toEqual({
      mode: 'search',
      token: 'search',
      arg: 'hello world',
    });
  });

  it('collapses leading/separator whitespace but keeps the arg intact', () => {
    expect(parseCommandInput('  create   hrn:org:acme')).toEqual({
      mode: 'create',
      token: 'create',
      arg: 'hrn:org:acme',
    });
  });

  it('matches the command word case-insensitively', () => {
    expect(parseCommandInput('OPEN hrn:org:acme')).toMatchObject({ mode: 'open', arg: 'hrn:org:acme' });
  });

  it('an unrecognized first token → mode null (unknown command)', () => {
    expect(parseCommandInput('nope hrn:org:acme')).toEqual({
      mode: null,
      token: 'nope',
      arg: 'hrn:org:acme',
    });
    expect(parseCommandInput('')).toEqual({ mode: null, token: '', arg: '' });
  });
});

describe('typed input → parse → route (the path the component drives)', () => {
  it('"open <urn>" → the /app/u resolver route', async () => {
    const { mode, arg } = parseCommandInput('open hrn:node:acme::docs::intro');
    expect(mode).toBe('open');
    expect(await buildCommandRoute(mode!, arg, resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:acme::docs::intro',
    });
  });

  it('"search hello world" → the global search page', async () => {
    const { mode, arg } = parseCommandInput('search hello world');
    expect(await buildCommandRoute(mode!, arg, resolve)).toEqual({
      ok: true,
      path: '/app/search?q=hello%20world',
    });
  });
});
