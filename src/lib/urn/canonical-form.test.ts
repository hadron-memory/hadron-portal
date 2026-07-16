import { describe, expect, it } from 'vitest';
import { toCanonicalForPreview, isFullyCanonical } from './canonical-form';

describe('toCanonicalForPreview', () => {
  it('returns canonical v2 form for a canonical-input URN', () => {
    const result = toCanonicalForPreview('hrn:agent:hadronmemory.com:coding-agent');
    expect(result).toEqual({
      canonical: 'hrn:agent:hadronmemory.com:coding-agent',
      needsServerCanonicalization: false,
    });
  });

  it('normalizes a legacy urn: scheme on an otherwise v2-flat input', () => {
    const result = toCanonicalForPreview('urn:node:hadronmemory.com:dev:review:sort-imports');
    expect(result).toEqual({
      canonical: 'hrn:node:hadronmemory.com:dev:review:sort-imports',
      needsServerCanonicalization: false,
    });
  });

  it('uses the v2 memory type name', () => {
    expect(toCanonicalForPreview('hrn:mem:hadronmemory.com:coding-agent')).toEqual({
      canonical: 'hrn:mem:hadronmemory.com:coding-agent',
      needsServerCanonicalization: false,
    });
    expect(toCanonicalForPreview('hrn:memory:hadronmemory.com:coding-agent')).toBeNull();
  });

  it('accepts v2 node-data fragments on node and apprun URNs', () => {
    expect(toCanonicalForPreview('hrn:node:hadronmemory.com:dev:review:render-urn#data')).toEqual({
      canonical: 'hrn:node:hadronmemory.com:dev:review:render-urn#data',
      needsServerCanonicalization: false,
    });
    expect(toCanonicalForPreview('hrn:apprun:hadronmemory.com:portal:run_123#data')).toEqual({
      canonical: 'hrn:apprun:hadronmemory.com:portal:run_123#data',
      needsServerCanonicalization: false,
    });
  });

  it('returns null for invalid or v1-chain URNs', () => {
    expect(toCanonicalForPreview('not-a-urn')).toBeNull();
    expect(toCanonicalForPreview('urn:loc:foo')).toBeNull();
    expect(toCanonicalForPreview('urn:memory:org::')).toBeNull();
    expect(toCanonicalForPreview('hrn:node:hadronmemory.com::dev::review:render-urn')).toBeNull();
  });
});

describe('isFullyCanonical', () => {
  it('returns true for canonical v2 inputs', () => {
    expect(isFullyCanonical('hrn:agent:hadronmemory.com:coding-agent')).toBe(true);
    expect(isFullyCanonical('hrn:mem:hadronmemory.com:coding-agent')).toBe(true);
    expect(isFullyCanonical('hrn:node:hadronmemory.com:dev:review:render-urn')).toBe(true);
  });

  it('returns false for legacy schemes, v1 chains, and invalid URNs', () => {
    expect(isFullyCanonical('urn:agent:hadronmemory.com:coding-agent')).toBe(false);
    expect(isFullyCanonical('hrn:memory:hadronmemory.com:coding-agent')).toBe(false);
    expect(isFullyCanonical('hrn:node:hadronmemory.com::dev::review:render-urn')).toBe(false);
    expect(isFullyCanonical('not-a-urn')).toBe(false);
  });
});
