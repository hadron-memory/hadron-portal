import { describe, expect, it } from 'vitest';
import { openUrnCandidates } from './open-urn-candidates';

// #567 — qualification of the command bar's `open` argument. The user-reported
// repro: a bare node path (`hadronmemory.com::hadron-portal::review:…`) pasted
// into `open` rode through unqualified and dead-ended at the resolver.

describe('openUrnCandidates — scheme-prefixed input', () => {
  it('canonical hrn: input → itself, alone', () => {
    expect(openUrnCandidates('hrn:node:acme.com::docs::intro')).toEqual([
      'hrn:node:acme.com::docs::intro',
    ]);
  });

  it('legacy urn: scheme is canonicalized to hrn:', () => {
    expect(openUrnCandidates('urn:memory:acme.com::docs')).toEqual(['hrn:memory:acme.com::docs']);
  });

  it('a malformed scheme-prefixed URN is NOT second-guessed', () => {
    expect(openUrnCandidates('hrn:node:not a slug')).toEqual([]);
    expect(openUrnCandidates('hrn:banana:acme.com')).toEqual([]);
  });

  it('surrounding whitespace is trimmed', () => {
    expect(openUrnCandidates('  hrn:org:acme.com  ')).toEqual(['hrn:org:acme.com']);
  });
});

describe('openUrnCandidates — type-prefixed but schemeless', () => {
  it('a known type word gets the hrn: scheme', () => {
    expect(openUrnCandidates('node:acme.com::docs::intro')).toEqual([
      'hrn:node:acme.com::docs::intro',
    ]);
    expect(openUrnCandidates('memory:acme.com::docs')).toEqual(['hrn:memory:acme.com::docs']);
  });

  it('the type word is matched case-insensitively (hand-typed "Node:")', () => {
    expect(openUrnCandidates('Node:acme.com::docs::intro')).toEqual([
      'hrn:node:acme.com::docs::intro',
    ]);
  });
});

describe('openUrnCandidates — bare hierarchy paths', () => {
  it('one segment → org, then user', () => {
    expect(openUrnCandidates('acme.com')).toEqual(['hrn:org:acme.com', 'hrn:user:acme.com']);
  });

  it('two segments → memory, agent, app', () => {
    expect(openUrnCandidates('acme.com::docs')).toEqual([
      'hrn:memory:acme.com::docs',
      'hrn:agent:acme.com::docs',
      'hrn:app:acme.com::docs',
    ]);
  });

  it('three+ segments → node first, then memory (the #567 repro)', () => {
    // A loc-style final segment (`review:…`) is not a valid memory leaf, so
    // the grammar itself prunes the memory guess — only the node form remains.
    expect(
      openUrnCandidates('hadronmemory.com::hadron-portal::review:superforms-typed-messages'),
    ).toEqual(['hrn:node:hadronmemory.com::hadron-portal::review:superforms-typed-messages']);
    // A plain final segment keeps both guesses, node first.
    expect(openUrnCandidates('acme.com::docs::intro')).toEqual([
      'hrn:node:acme.com::docs::intro',
      'hrn:memory:acme.com::docs::intro',
    ]);
  });

  it('a role-marker final segment flips the guess to memory first (per-user memories)', () => {
    expect(openUrnCandidates('acme.com::helper::app-user:u123')).toEqual([
      'hrn:memory:acme.com::helper::app-user:u123',
      'hrn:node:acme.com::helper::app-user:u123',
    ]);
  });

  it('un-URN-able input → no candidates', () => {
    expect(openUrnCandidates('not a urn at all')).toEqual([]);
    expect(openUrnCandidates('')).toEqual([]);
    expect(openUrnCandidates('   ')).toEqual([]);
  });
});

// #815 — a valid `hrn:worker:` URN was refused by the command bar with
// "Not a valid URN." while `/app/u/<the same URN>` resolved it. The cause was
// this module gating on `parseUrn`, which structurally cannot represent a
// v2-ONLY type: it parses v1 and, on failure, delegates through a path
// requiring the v2 word to have a v1 equivalent, which `worker` has none of.
describe('openUrnCandidates — v2-only types (#815)', () => {
  const ALEX = 'hrn:worker:micromentor.org:mm-eng-team:alex';

  it('qualifies the reported URN instead of refusing it', () => {
    expect(openUrnCandidates(ALEX)).toEqual([ALEX]);
  });

  it('qualifies a schemeless worker paste', () => {
    // `worker:` is a type word people type, and the platform prints the full
    // URN — so both shapes reach the bar.
    expect(openUrnCandidates('worker:micromentor.org:mm-eng-team:alex')).toEqual([ALEX]);
  });

  it('canonicalizes the legacy urn: scheme, like every other type', () => {
    // Recomposed from the parse rather than passed through, so this normalizes
    // the same way `parserCanonical` does on the v1 path.
    expect(openUrnCandidates('urn:worker:micromentor.org:mm-eng-team:alex')).toEqual([ALEX]);
  });

  it('still refuses a MALFORMED worker URN', () => {
    // The point of the fix is not "let worker through" — it is to ask the
    // parser that can express it. `parseUrnV2` is a real validator, so an
    // explicit-but-wrong type is still not second-guessed.
    expect(openUrnCandidates('hrn:worker:acme.com')).toEqual([]); // wrong arity
    expect(openUrnCandidates('hrn:worker:acme.com::team::x')).toEqual([]); // v1 separators
  });

  // #1914 (portal#2150 F2): `open hrn:agenttask:…` said "Not a valid URN." while
  // `/app/u/<the same URN>` resolves it since hadron-server#3878.
  it('qualifies a served task URN (#1914)', () => {
    const TASK = 'hrn:agenttask:hadronmemory.com:hadron-dev-team:at3.405';
    expect(openUrnCandidates(TASK)).toEqual([TASK]);
    expect(openUrnCandidates('hrn:agenttask:hadronmemory.com:hadron-dev-team')).toEqual([]); // no handle
    expect(openUrnCandidates('hrn:agenttask:hadronmemory.com::hadron-dev-team::at3.405')).toEqual([]); // v1 separators
  });

  it('refuses a v2-only type with no portal page', () => {
    // Qualifying to a kind `/app/u/[urn]` cannot redirect would trade one dead
    // end for another — the rule this module already applied to v1 types.
    for (const urn of [
      'hrn:apprun:acme.com:run-1',
      'hrn:appkey:acme.com:key-1',
      'hrn:noderev:acme.com:mem:loc:1',
    ]) {
      expect(openUrnCandidates(urn)).toEqual([]);
    }
  });

  it('leaves every v1 form exactly as it was', () => {
    // The v2 attempt is a FALLBACK: it runs only where `parseUrn` already
    // failed, so nothing that used to resolve can change.
    expect(openUrnCandidates('hrn:agent:acme.com:alex')).toEqual(['hrn:agent:acme.com:alex']);
    expect(openUrnCandidates('hrn:mem:acme.com:docs')).toEqual(['hrn:mem:acme.com:docs']);
    expect(openUrnCandidates('hrn:user:holger')).toEqual(['hrn:user:holger']);
    expect(openUrnCandidates('acme.com::docs::intro')).toEqual([
      'hrn:node:acme.com::docs::intro',
      'hrn:memory:acme.com::docs::intro',
    ]);
  });

  it('does not start guessing worker for a bare hierarchy path', () => {
    // Deliberate: a bare paste is ambiguous, worker URNs are essentially always
    // pasted WITH their scheme (that is how the platform prints them), and
    // adding a kind to the guess list costs a resolver probe on every miss.
    expect(openUrnCandidates('micromentor.org::mm-eng-team::alex')).not.toContain(
      'hrn:worker:micromentor.org::mm-eng-team::alex',
    );
  });
});
