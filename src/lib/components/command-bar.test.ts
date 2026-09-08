import { describe, it, expect, vi } from 'vitest';
import {
  COMMANDS,
  buildCommandRoute,
  parseCommand,
  resolveCommandAction,
  type CommandSpec,
  type UrnResolution,
} from './command-bar';

// A resolve stub that knows one org + one memory; everything else is "no access".
const resolve = vi.fn(async (urn: string): Promise<UrnResolution | null> => {
  if (urn === 'hrn:org:acme') return { kind: 'org', id: 'org-1', memoryId: null, organizationId: 'org-1' };
  if (urn === 'hrn:memory:acme::docs') return { kind: 'memory', id: 'mem-1', memoryId: 'mem-1', organizationId: 'org-1' };
  return null;
});

const cmd = (id: string): CommandSpec => {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
};

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

  it('open → the /app/u resolver route with the canonical URN (no resolve call)', async () => {
    resolve.mockClear();
    expect(await buildCommandRoute('open', '  hrn:node:acme::docs::intro  ', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:acme::docs::intro',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  // #567 — open qualifies non-canonical input before navigating.
  it('open with a schemeless type prefix → hrn: added, no resolve call', async () => {
    resolve.mockClear();
    expect(await buildCommandRoute('open', 'node:acme::docs::intro', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:acme::docs::intro',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('open with a bare 2-segment path → probes candidates, first resolving kind wins', async () => {
    expect(await buildCommandRoute('open', 'acme::docs', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:memory:acme::docs',
    });
  });

  it('open with a bare 1-segment path → org resolves first', async () => {
    expect(await buildCommandRoute('open', 'acme', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:org:acme',
    });
  });

  it('open with a bare path no candidate resolves → navigates to the best guess (node)', async () => {
    expect(await buildCommandRoute('open', 'ghost.com::docs::intro:setup', resolve)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:ghost.com::docs::intro:setup',
    });
  });

  it('open with un-URN-able input → inline error, no navigation', async () => {
    expect(await buildCommandRoute('open', 'not a urn at all', resolve)).toMatchObject({ ok: false });
  });

  // #615 — a resolver outage during probing is not "doesn't resolve".
  it('open probing that hits a resolver outage → inline error, NOT best-guess navigation', async () => {
    const outage = vi.fn(async (): Promise<UrnResolution | null> => {
      throw new Error('resolve failed (500)');
    });
    expect(await buildCommandRoute('open', 'acme::docs', outage)).toMatchObject({ ok: false });
  });

  it('a single-candidate open never probes, so an outage cannot block it', async () => {
    const outage = vi.fn(async (): Promise<UrnResolution | null> => {
      throw new Error('resolve failed (500)');
    });
    expect(await buildCommandRoute('open', 'hrn:node:acme::docs::intro', outage)).toEqual({
      ok: true,
      path: '/app/u/hrn:node:acme::docs::intro',
    });
    expect(outage).not.toHaveBeenCalled();
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

  it('create node → resolves the memory (path minus last segment), loc = last segment', async () => {
    expect(await buildCommandRoute('create', 'hrn:node:acme::docs::intro:welcome', resolve)).toEqual({
      ok: true,
      path: '/app/memories/mem-1/nodes/new?loc=intro%3Awelcome',
    });
  });

  it('create with an unresolvable parent org → inline error, no navigation', async () => {
    expect((await buildCommandRoute('create', 'hrn:memory:ghost::docs', resolve)).ok).toBe(false);
  });

  it('create with a malformed URN → inline parse error', async () => {
    expect((await buildCommandRoute('create', 'not-a-urn', resolve)).ok).toBe(false);
  });
});

describe('COMMANDS registry', () => {
  it('each command has triggers + a tint, and arg commands carry a hint', () => {
    for (const c of COMMANDS) {
      expect(c.triggers.length).toBeGreaterThan(0);
      expect(c.tint).toBeTruthy();
      if (c.arg) expect(c.arg.hint).toBeTruthy();
    }
  });

  it('triggers are globally unique (no phrase maps to two commands)', () => {
    const all = COMMANDS.flatMap((c) => c.triggers);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('parseCommand — selecting phase (dropdown)', () => {
  it('empty input → the full palette, no exact command', () => {
    const p = parseCommand('');
    expect(p.phase).toBe('selecting');
    expect(p.command).toBeNull();
    expect(p.matches).toEqual(COMMANDS);
  });

  it('prefix filters the matches (a → account/agents/apps/app-keys)', () => {
    const ids = parseCommand('a').matches.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['account', 'agents', 'apps', 'app-keys']));
    expect(ids).not.toContain('open');
  });

  it('narrows multi-word triggers as you type ("app" → apps + app-keys, "app k" → app-keys)', () => {
    expect(parseCommand('app').matches.map((c) => c.id).sort()).toEqual(['app-keys', 'apps']);
    expect(parseCommand('app k').matches.map((c) => c.id)).toEqual(['app-keys']);
  });

  it('an exact trigger sets command (incl. aliases)', () => {
    expect(parseCommand('account').command?.id).toBe('account');
    expect(parseCommand('dashboard').command?.id).toBe('org'); // alias of org
    expect(parseCommand('switch organization').command?.id).toBe('switch');
    expect(parseCommand('logout').command?.id).toBe('sign-out');
    expect(parseCommand('find').command?.id).toBe('search'); // alias of search
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseCommand('  ACCOUNT  ').command?.id).toBe('account');
  });

  it('unknown text → no command, no matches', () => {
    const p = parseCommand('zzzz');
    expect(p.command).toBeNull();
    expect(p.matches).toEqual([]);
  });
});

describe('parseCommand — arg phase', () => {
  it('"open <urn>" → arg phase with the URN preserved', () => {
    expect(parseCommand('open hrn:node:acme::docs::intro')).toMatchObject({
      phase: 'arg',
      arg: 'hrn:node:acme::docs::intro',
    });
    expect(parseCommand('open hrn:node:acme::docs::intro').command?.id).toBe('open');
  });

  it('preserves inner spaces in the argument (search phrase)', () => {
    expect(parseCommand('search hello world')).toMatchObject({ phase: 'arg', arg: 'hello world' });
  });

  it('collapses the separator whitespace but keeps the arg', () => {
    expect(parseCommand('create   hrn:org:acme')).toMatchObject({ phase: 'arg', arg: 'hrn:org:acme' });
  });

  it('invite takes an email argument', () => {
    const p = parseCommand('invite alice@acme.com');
    expect(p.command?.id).toBe('invite');
    expect(p.arg).toBe('alice@acme.com');
  });

  it('the "find" alias enters search arg phase', () => {
    const p = parseCommand('find hello world');
    expect(p.command?.id).toBe('search');
    expect(p.arg).toBe('hello world');
  });

  it('a no-arg command does NOT enter arg phase (trailing junk → no match)', () => {
    const p = parseCommand('team foo');
    expect(p.phase).toBe('selecting');
    expect(p.command).toBeNull();
    expect(p.matches).toEqual([]);
  });

  it('"open " (trailing space, empty arg) is already arg phase', () => {
    expect(parseCommand('open ')).toMatchObject({ phase: 'arg', arg: '' });
  });
});

describe('resolveCommandAction', () => {
  const ctx = { activeOrgId: 'org-7', resolve };

  it('org / dashboard → the active org page', async () => {
    expect(await resolveCommandAction(cmd('org'), '', ctx)).toEqual({ type: 'navigate', path: '/app/orgs/org-7' });
  });

  it('active-org list routes → /app/orgs/<pk>/<list>', async () => {
    expect(await resolveCommandAction(cmd('team'), '', ctx)).toEqual({ type: 'navigate', path: '/app/orgs/org-7/members' });
    expect(await resolveCommandAction(cmd('memories'), '', ctx)).toEqual({ type: 'navigate', path: '/app/orgs/org-7/memories' });
    expect(await resolveCommandAction(cmd('agents'), '', ctx)).toEqual({ type: 'navigate', path: '/app/orgs/org-7/agents' });
    expect(await resolveCommandAction(cmd('apps'), '', ctx)).toEqual({ type: 'navigate', path: '/app/orgs/org-7/apps' });
  });

  it('falls back gracefully when there is no active org PK', async () => {
    const noOrg = { activeOrgId: null, resolve };
    expect(await resolveCommandAction(cmd('org'), '', noOrg)).toEqual({ type: 'navigate', path: '/app/dashboard' });
    expect((await resolveCommandAction(cmd('team'), '', noOrg)).type).toBe('error');
  });

  it('account / app keys → fixed account routes', async () => {
    expect(await resolveCommandAction(cmd('account'), '', ctx)).toEqual({ type: 'navigate', path: '/app/account' });
    expect(await resolveCommandAction(cmd('app-keys'), '', ctx)).toEqual({ type: 'navigate', path: '/app/account/api-keys' });
  });

  it('access check → the command page (#375)', async () => {
    expect(await resolveCommandAction(cmd('access-check'), '', ctx)).toEqual({
      type: 'navigate',
      path: '/app/commands/access-check',
    });
  });

  it('merge node → the command page (#395)', async () => {
    expect(await resolveCommandAction(cmd('merge-node'), '', ctx)).toEqual({
      type: 'navigate',
      path: '/app/commands/merge-node',
    });
  });

  it('merge memory → the command page (#396)', async () => {
    expect(await resolveCommandAction(cmd('merge-memory'), '', ctx)).toEqual({
      type: 'navigate',
      path: '/app/commands/merge-memory',
    });
  });

  it('invite → the invite page, with the email prefilled when given', async () => {
    expect(await resolveCommandAction(cmd('invite'), 'a@b.com', ctx)).toEqual({
      type: 'navigate',
      path: '/app/account/invite?email=a%40b.com',
    });
    expect(await resolveCommandAction(cmd('invite'), '', ctx)).toEqual({ type: 'navigate', path: '/app/account/invite' });
  });

  it('switch → opens the org popup; sign out → external redirect', async () => {
    expect(await resolveCommandAction(cmd('switch'), '', ctx)).toEqual({ type: 'switch' });
    expect(await resolveCommandAction(cmd('sign-out'), '', ctx)).toEqual({ type: 'external', url: '/auth/signout' });
  });

  it('open / search / create delegate to buildCommandRoute', async () => {
    expect(await resolveCommandAction(cmd('open'), 'hrn:node:acme::docs::intro', ctx)).toEqual({
      type: 'navigate',
      path: '/app/u/hrn:node:acme::docs::intro',
    });
    expect(await resolveCommandAction(cmd('search'), 'hello world', ctx)).toEqual({
      type: 'navigate',
      path: '/app/search?q=hello%20world',
    });
    expect(await resolveCommandAction(cmd('create'), 'hrn:org:acme', ctx)).toEqual({
      type: 'navigate',
      path: '/app/orgs/new?urn=acme',
    });
  });

  it('a URN command with an empty/invalid argument → inline error', async () => {
    expect((await resolveCommandAction(cmd('open'), '', ctx)).type).toBe('error');
    expect((await resolveCommandAction(cmd('create'), 'not-a-urn', ctx)).type).toBe('error');
  });
});

// #815 — the user-facing half of the fix. `openUrnCandidates` producing a
// candidate is necessary but not sufficient; what @Holger reported is the bar
// answering "Not a valid URN.", which is `buildOpenRoute`'s empty-candidate
// branch. These assert the ROUTE, not the qualifier.
describe('buildCommandRoute — open a worker URN (#815)', () => {
  const ALEX = 'hrn:worker:micromentor.org:mm-eng-team:alex';

  it('routes a valid worker URN to the resolver page instead of refusing it', async () => {
    // Single candidate, so no resolve probe is needed — the bar navigates and
    // `/app/u/[urn]` does the resolving, which is the division of labour that
    // route's own comment describes.
    expect(await buildCommandRoute('open', ALEX, resolve)).toEqual({
      ok: true,
      path: `/app/u/${ALEX}`,
    });
  });

  it('accepts the schemeless and legacy-scheme spellings too', async () => {
    for (const input of [
      'worker:micromentor.org:mm-eng-team:alex',
      'urn:worker:micromentor.org:mm-eng-team:alex',
    ]) {
      expect(await buildCommandRoute('open', input, resolve)).toEqual({
        ok: true,
        path: `/app/u/${ALEX}`,
      });
    }
  });

  it('still says "Not a valid URN." for a malformed worker URN', async () => {
    // The fix asks a parser that can express `worker`; it does not stop
    // validating. An explicit-but-wrong type must still be refused rather than
    // second-guessed.
    expect(await buildCommandRoute('open', 'hrn:worker:acme.com', resolve)).toMatchObject({
      ok: false,
    });
  });
});
