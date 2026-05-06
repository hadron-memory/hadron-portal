import { describe, it, expect } from 'vitest';
import { cleanLocInput } from './clean-loc-input';

describe('cleanLocInput', () => {
  it('passes through a bare loc', () => {
    expect(cleanLocInput('review:render-urn')).toBe('review:render-urn');
  });

  it('strips canonical urn:node: prefix', () => {
    expect(cleanLocInput('urn:node:hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('strips wrong-type urn:memory: prefix (the #100 #4 bug)', () => {
    expect(cleanLocInput('urn:memory:hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('strips legacy loc: prefix', () => {
    expect(cleanLocInput('loc:review:render-urn')).toBe('review:render-urn');
  });

  it('strips bare memory-prefixed loc', () => {
    expect(cleanLocInput('hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('handles a single-segment loc with no prefix', () => {
    expect(cleanLocInput('urn-format')).toBe('urn-format');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanLocInput('  review:render-urn  ')).toBe('review:render-urn');
  });

  it('normalizes forward slashes to colons (legacy path-style locs)', () => {
    expect(cleanLocInput('review/render-urn')).toBe('review:render-urn');
  });

  it('normalizes mixed path-style + colon legacy artifacts', () => {
    expect(cleanLocInput('foo/bar:baz')).toBe('foo:bar:baz');
  });

  it('does not strip memory prefix when first segment has no dot', () => {
    expect(cleanLocInput('section:nested:leaf')).toBe('section:nested:leaf');
  });

  // Asymmetric prefix handling (intentional): only node and memory URNs
  // get stripped to a bare loc. Other URN types pasted into a loc field
  // are user-paste mistakes — leave them so the server rejects clearly.
  it('does not strip urn:agent: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:agent:micromentor.org:mmcoding-agent'))
      .toBe('urn:agent:micromentor.org:mmcoding-agent');
  });

  it('does not strip urn:app: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:app:micromentor.org:mmcoding'))
      .toBe('urn:app:micromentor.org:mmcoding');
  });

  it('does not strip urn:org: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:org:micromentor.org')).toBe('urn:org:micromentor.org');
  });
});
