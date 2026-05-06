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

  it('removes forward slashes from legacy artifacts', () => {
    expect(cleanLocInput('review/render-urn')).toBe('reviewrender-urn');
  });

  it('does not strip memory prefix when first segment has no dot', () => {
    expect(cleanLocInput('section:nested:leaf')).toBe('section:nested:leaf');
  });
});
