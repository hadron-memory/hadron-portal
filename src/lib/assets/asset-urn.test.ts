import { describe, expect, it } from 'vitest';
import { memoryUrnFromAssetUrn, memoryLabelFromAssetUrn } from './asset-urn';

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

  it('accepts a urn: scheme as well as hrn:', () => {
    expect(memoryUrnFromAssetUrn('urn:asset:holger:jens:assets:abc')).toBe('hrn:mem:holger:jens');
  });

  it('cuts at the LAST separator, so a slug containing "assets" survives', () => {
    // A memory legitimately slugged `assets` would break an indexOf-based split.
    expect(memoryUrnFromAssetUrn('hrn:asset:acme:assets:assets:abc')).toBe('hrn:mem:acme:assets');
  });

  it('PRESERVES a legacy ownership chain instead of flattening it', () => {
    // PR #704 review, codex P1. More than two atoms is an ownership chain
    // (<org>::<app>::<agent>::<memory>), which has NO string-derivable v2 form —
    // v2's fixed arity would read atom 1 as the whole slug and address a
    // different memory. Emit v1, which the server resolves via its alias map.
    // Same rule composeNodeUrn implements for nodes.
    expect(memoryUrnFromAssetUrn('hrn:asset:acme:app:agent:system:assets:abc')).toBe(
      'hrn:memory:acme::app::agent::system',
    );
  });

  it('preserves a chain that arrived already :: -separated', () => {
    expect(memoryUrnFromAssetUrn('acme::app::agent::system:assets:abc')).toBe(
      'hrn:memory:acme::app::agent::system',
    );
  });

  it('never emits a flattened chain, in either input grammar', () => {
    // The regression guard: a flat 4-atom v2 spelling would silently point at
    // another memory.
    for (const input of [
      'hrn:asset:acme:app:agent:system:assets:abc',
      'acme::app::agent::system:assets:abc',
    ]) {
      expect(memoryUrnFromAssetUrn(input)).not.toBe('hrn:mem:acme:app:agent:system');
    }
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

describe('memoryLabelFromAssetUrn', () => {
  it('drops the root, which is shared by every row', () => {
    expect(memoryLabelFromAssetUrn('hrn:asset:hadronmemory.com:dev:assets:abc')).toBe('dev');
  });

  it('keeps a chain reading as a chain, not as a v2 path', () => {
    expect(memoryLabelFromAssetUrn('hrn:asset:acme:app:agent:system:assets:abc')).toBe(
      'app::agent::system',
    );
  });

  it('falls back to the whole thing when there is nothing below the root', () => {
    expect(memoryLabelFromAssetUrn('hrn:asset:solo:assets:abc')).toBe('solo');
  });

  it('is null when the URN does not parse', () => {
    expect(memoryLabelFromAssetUrn('nonsense')).toBeNull();
  });
});
