import { describe, expect, it } from 'vitest';
import { toCanonicalForPreview, isFullyCanonical } from './canonical-form';

describe('toCanonicalForPreview', () => {
  it('returns canonical form for a canonical-input URN with no resolver needed', () => {
    const result = toCanonicalForPreview('urn:agent:hadronmemory.com::coding-agent');
    expect(result).toEqual({
      canonical: 'urn:agent:hadronmemory.com::coding-agent',
      needsServerCanonicalization: false,
    });
  });

  it('returns parser-layer canonical for a type-markered (cat 4) input', () => {
    const result = toCanonicalForPreview(
      'urn:agent:micromentor.org::app:coding-app::agent:hadronmemory.com:coding-agent',
    );
    expect(result?.canonical).toBe(
      'urn:agent:micromentor.org::coding-app::hadronmemory.com:coding-agent',
    );
    expect(result?.needsServerCanonicalization).toBe(false);
  });

  it('flags needsServerCanonicalization for a shortened-form input (cat 3)', () => {
    const result = toCanonicalForPreview(
      'urn:agent:micromentor.org::coding-app::coding-agent',
    );
    expect(result?.needsServerCanonicalization).toBe(true);
  });

  it('flags needsServerCanonicalization for an urn:node: URN that may have a role (cat 2)', () => {
    const result = toCanonicalForPreview(
      'urn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports',
    );
    expect(result?.needsServerCanonicalization).toBe(true);
  });

  it('returns null for an invalid URN (parse error)', () => {
    expect(toCanonicalForPreview('not-a-urn')).toBeNull();
    expect(toCanonicalForPreview('urn:loc:foo')).toBeNull();
    expect(toCanonicalForPreview('urn:memory:org::')).toBeNull();
  });

  it('returns null for a reserved-word slug at a non-structural position', () => {
    expect(toCanonicalForPreview('urn:memory:acme.com::system')).toBeNull();
  });
});

describe('isFullyCanonical', () => {
  it('returns true for canonical inputs that need no resolver', () => {
    expect(isFullyCanonical('urn:agent:hadronmemory.com::coding-agent')).toBe(true);
    expect(isFullyCanonical('urn:memory:hadronmemory.com::coding-agent::system')).toBe(true);
  });

  it('returns false for inputs needing parser-layer rewrites', () => {
    expect(
      isFullyCanonical('urn:agent:micromentor.org::app:coding-app::agent:hadronmemory.com:coding-agent'),
    ).toBe(false);
  });

  it('returns false for inputs needing resolver-layer rewrites', () => {
    // Shortened form (cat 3)
    expect(
      isFullyCanonical('urn:agent:micromentor.org::coding-app::coding-agent'),
    ).toBe(false);
    // urn:node: form (cat 2 may apply)
    expect(
      isFullyCanonical('urn:node:micromentor.org::coding-app::coding-agent::system::leaf'),
    ).toBe(false);
  });

  it('returns false for invalid URNs', () => {
    expect(isFullyCanonical('not-a-urn')).toBe(false);
    expect(isFullyCanonical('urn:loc:foo')).toBe(false);
  });
});
