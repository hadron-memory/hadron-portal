import { describe, expect, it } from 'vitest';
import { parseUrn, UrnParseError } from './parse-urn';

/**
 * portal#2108 (S0b): the App secret URN, through this repo's own entry point.
 * The grammar lives in @hadron-memory/urn-lib-js (hrn:node:hadronmemory.com:specs:cor:urn:010:01, "libs learn it
 * first"); these pins prove the pinned release is the one the portal needs, not the grammar itself.
 */
describe('portal#2108: App secret URN via the urn-lib-js shim', () => {
  const APP = 'hrn:secret:acme.com:app:eng-team:openai-key';
  const FLAT = 'hrn:secret:acme.com:stripe-key';

  it('parses the App shape and round-trips it', () => {
    const p = parseUrn(APP);
    expect(p.type).toBe('secret');
    expect(p.parserCanonical).toBe(APP);
    expect(parseUrn(p.parserCanonical).parserCanonical).toBe(APP);
  });

  it('leaves the org/user shape unchanged', () => {
    const p = parseUrn(FLAT);
    expect(p.type).toBe('secret');
    expect(p.parserCanonical).toBe(FLAT);
  });

  it('a flat secret named "app" still parses flat: arity decides, not the word', () => {
    expect(parseUrn('hrn:secret:acme.com:app').parserCanonical).toBe('hrn:secret:acme.com:app');
  });

  it.each([
    ['v2 three-segment without the literal app (#679)', 'hrn:secret:acme.com:eng-team:openai-key'],
    ['v2 with a memory middle', 'hrn:secret:acme.com:memory:eng-team:openai-key'],
    ['v2 with an org middle', 'hrn:secret:acme.com:org:eng-team:openai-key'],
    ['legacy ::app owner-scoped spelling (#679)', 'hrn:secret:acme.com::app:eng-team::openai-key'],
    ['legacy ::memory owner-scoped spelling (#679)', 'hrn:secret:acme.com::memory:eng-team::openai-key'],
    ['legacy urn: prefix with ::app', 'urn:secret:acme.com::app:eng-team::openai-key'],
  ])('refuses %s', (_label, input) => {
    expect(() => parseUrn(input)).toThrow(UrnParseError);
  });
});
