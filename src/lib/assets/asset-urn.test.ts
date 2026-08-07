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
    // createAssetReferenceNode falls back to `${memory.urn}:assets:${id}` when
    // strict v2 emission throws.
    expect(memoryUrnFromAssetUrn('hadronmemory.com:dev:assets:abc')).toBe(
      'hrn:mem:hadronmemory.com:dev',
    );
  });

  it('normalises a legacy :: hierarchy to v2 single colons', () => {
    // v1 stays accepted on input forever (cor:urn:010:01); we emit v2.
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

  it('handles a multi-atom (legacy ownership-chain) memory part', () => {
    expect(memoryUrnFromAssetUrn('hrn:asset:acme:app:agent:system:assets:abc')).toBe(
      'hrn:mem:acme:app:agent:system',
    );
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

  it('keeps every slug atom below the root', () => {
    expect(memoryLabelFromAssetUrn('hrn:asset:acme:app:agent:system:assets:abc')).toBe(
      'app:agent:system',
    );
  });

  it('falls back to the whole thing when there is nothing below the root', () => {
    expect(memoryLabelFromAssetUrn('hrn:asset:solo:assets:abc')).toBe('solo');
  });

  it('is null when the URN does not parse', () => {
    expect(memoryLabelFromAssetUrn('nonsense')).toBeNull();
  });
});
