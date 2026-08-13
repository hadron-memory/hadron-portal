import { describe, expect, it } from 'vitest';
import { memoryUrnFromAssetUrn } from './asset-urn';

describe('memoryUrnFromAssetUrn', () => {
  it('derives the memory URN from the v2 asset URN the server emits', () => {
    // emitAssetUrnV2('holger:jens', id) → composeUrnV2('asset','holger','jens','assets',id)
    expect(memoryUrnFromAssetUrn('hrn:asset:holger:jens:assets:019ee1b0cac2')).toBe(
      'hrn:mem:holger:jens',
    );
  });

  it('handles a dotted org root', () => {
    expect(memoryUrnFromAssetUrn('hrn:asset:hadronmemory.com:dev:assets:abc123')).toBe(
      'hrn:mem:hadronmemory.com:dev',
    );
  });

  it('accepts the bare form the legacy fallback path can emit', () => {
    // Asset.urn falls back to `${memory.urn}:assets:${id}` when strict v2
    // emission throws.
    expect(memoryUrnFromAssetUrn('hadronmemory.com:dev:assets:abc')).toBe(
      'hrn:mem:hadronmemory.com:dev',
    );
  });

  it('accepts an hrn:mem:-prefixed asset urn without doubling the prefix', () => {
    // Same fallback, but with a PREFIXED Memory.urn: `${memory.urn}:assets:${id}`
    // then starts `hrn:mem:`. Stripping only `hrn:asset:` left the prefix in the
    // memory part and composed `hrn:mem:hrn:mem:holger:jens` (PR #704 review,
    // Copilot — reported against the SDL docstring, real against the fallback).
    expect(memoryUrnFromAssetUrn('hrn:mem:holger:jens:assets:abc')).toBe('hrn:mem:holger:jens');
    expect(memoryUrnFromAssetUrn('hrn:memory:holger:jens:assets:abc')).toBe('hrn:mem:holger:jens');
  });

  it('normalises a two-atom legacy :: memory to v2 single colons', () => {
    // Two atoms is root + slug, so the flat v2 spelling is derivable.
    expect(memoryUrnFromAssetUrn('hadronmemory.com::dev:assets:abc')).toBe(
      'hrn:mem:hadronmemory.com:dev',
    );
  });

  it('declines a v1 OWNERSHIP CHAIN rather than flattening it', () => {
    // >2 atoms written with `::` is the `<org>::<app>::<agent>::<memory>` chain.
    // It has no string-derivable v2 form (see composeNodeUrn): flattening would
    // compose `hrn:mem:acme:app:agent:system`, which addresses a DIFFERENT
    // memory than the chain's stored alias — a wrong link, silently.
    // Only the `${memory.urn}:assets:${id}` fallback can deliver this shape;
    // the v2 emitter flattens via bareAtoms before we ever see it.
    // (PR #708 review — codex P2, seconded by Copilot.)
    expect(memoryUrnFromAssetUrn('acme::app::agent::system:assets:abc')).toBeNull();
    expect(memoryUrnFromAssetUrn('hrn:memory:acme::app::agent::system:assets:abc')).toBeNull();
  });

  it('still flattens a two-atom :: memory — that is not a chain', () => {
    // The guard above must not swallow the ordinary v1 root::slug rewrite.
    expect(memoryUrnFromAssetUrn('hrn:asset:acme.com::docs:assets:abc')).toBe(
      'hrn:mem:acme.com:docs',
    );
  });

  it('accepts a urn: scheme as well as hrn:', () => {
    expect(memoryUrnFromAssetUrn('urn:asset:holger:jens:assets:abc')).toBe('hrn:mem:holger:jens');
  });

  it('cuts at the LAST separator, so a slug containing "assets" survives', () => {
    // A memory legitimately slugged `assets` would break an indexOf-based split.
    expect(memoryUrnFromAssetUrn('hrn:asset:acme:assets:assets:abc')).toBe('hrn:mem:acme:assets');
  });

  it('handles a COMPOUND memory part — the arity is not two', () => {
    // composeUrnV2 has no arity rule for `asset`, so a compound memory urn
    // lengthens the URN. `mentor-co:juno:mike-personal` is in prisma/seed.ts, so
    // this is real: requiring exactly two atoms declined that memory's assets
    // outright. See hadron-server:findings:asset-urn-shapes-are-variable.
    expect(memoryUrnFromAssetUrn('hrn:asset:mentor-co:juno:mike-personal:assets:abc')).toBe(
      'hrn:mem:mentor-co:juno:mike-personal',
    );
  });

  it('strips a NESTED prefix instead of doubling it', () => {
    // A legacy memories.urn row can hold a rendered `hrn:mem:…`, and the normal
    // emission branch composes it straight through — chk_memory_urn_not_prefixed
    // is NOT VALID, so such rows survive. Stripping once produced
    // `hrn:mem:hrn:mem:acme.com:docs`.
    expect(memoryUrnFromAssetUrn('hrn:asset:hrn:mem:acme.com:docs:assets:abc')).toBe(
      'hrn:mem:acme.com:docs',
    );
  });

  it('declines the unknown-memory sentinel', () => {
    // `hrn:asset:unknown:assets:<id>` is what the server emits when it cannot load
    // the memory row — one atom, naming no memory.
    expect(memoryUrnFromAssetUrn('hrn:asset:unknown:assets:abc')).toBeNull();
  });

  it('rejects a path with an empty atom', () => {
    expect(memoryUrnFromAssetUrn('hrn:asset:acme::assets:abc')).toBeNull();
  });

  it('returns null rather than guessing when the shape is unrecognised', () => {
    // A wrong memory URN would link to somebody else's memory — worse than no link.
    expect(memoryUrnFromAssetUrn('hrn:asset:holger:jens')).toBeNull();
    expect(memoryUrnFromAssetUrn(':assets:abc')).toBeNull();
    expect(memoryUrnFromAssetUrn('nonsense')).toBeNull();
  });

  it('returns null for a truncated URN with nothing after the separator', () => {
    expect(memoryUrnFromAssetUrn('hrn:asset:holger:jens:assets:')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(memoryUrnFromAssetUrn(null)).toBeNull();
    expect(memoryUrnFromAssetUrn(undefined)).toBeNull();
    expect(memoryUrnFromAssetUrn('')).toBeNull();
  });
});
