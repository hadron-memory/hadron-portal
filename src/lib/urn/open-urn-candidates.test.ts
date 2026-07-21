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
