import { describe, expect, it } from 'vitest';
import { composeNodeUrn } from './compose-node-urn';

describe('composeNodeUrn', () => {
  describe('happy path', () => {
    it('composes with prefixed memory URN and simple loc', () => {
      expect(composeNodeUrn('urn:memory:micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'urn:node:micromentor.org:mmdata:review:sort-imports',
      );
    });

    it('composes with bare slug-path memory URN (no urn:memory: prefix)', () => {
      expect(composeNodeUrn('micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'urn:node:micromentor.org:mmdata:review:sort-imports',
      );
    });

    it('preserves all loc segments when loc has multiple colons', () => {
      expect(
        composeNodeUrn('urn:memory:hadronmemory.com:dev', 'a:b:c:d:e'),
      ).toBe('urn:node:hadronmemory.com:dev:a:b:c:d:e');
    });

    it('preserves a single-segment loc', () => {
      expect(composeNodeUrn('urn:memory:org:mem', 'top')).toBe('urn:node:org:mem:top');
    });
  });

  describe('PK-as-value pass-through (defect lives at caller, not composer)', () => {
    it('accepts a UUIDv7 as value without complaint', () => {
      const uuid = '0190ee19-8b3a-7d4f-b8e1-2f9c8b5d4a3e';
      expect(composeNodeUrn('urn:memory:org:mem', uuid)).toBe(`urn:node:org:mem:${uuid}`);
    });
  });

  describe('throws on wrong-type prefix', () => {
    it('rejects urn:agent:', () => {
      expect(() => composeNodeUrn('urn:agent:org:my-agent', 'loc')).toThrow(/memory/i);
    });

    it('rejects urn:org:', () => {
      expect(() => composeNodeUrn('urn:org:my-org', 'loc')).toThrow(/memory/i);
    });

    it('rejects urn:app:', () => {
      expect(() => composeNodeUrn('urn:app:org:my-app', 'loc')).toThrow(/memory/i);
    });

    it('rejects urn:node: (a node URN passed where a memory URN was expected)', () => {
      expect(() => composeNodeUrn('urn:node:org:mem:loc', 'inner')).toThrow(/memory/i);
    });

    it('rejects an unknown urn:<word>: prefix', () => {
      expect(() => composeNodeUrn('urn:unknown:foo', 'loc')).toThrow(/memory/i);
    });
  });

  describe('throws on empty inputs', () => {
    it('throws when value is empty', () => {
      expect(() => composeNodeUrn('urn:memory:org:mem', '')).toThrow(/empty|value/i);
    });

    it('throws when memoryUrn is empty', () => {
      expect(() => composeNodeUrn('', 'loc')).toThrow(/empty|memory/i);
    });

    it('throws when both inputs are empty', () => {
      expect(() => composeNodeUrn('', '')).toThrow();
    });
  });

  describe('round-trip', () => {
    it('produces a URN whose suffix after urn:node: matches memory-slug-path:loc', () => {
      const result = composeNodeUrn('urn:memory:hadronmemory.com:dev', 'conventions:urn-format');
      expect(result.startsWith('urn:node:')).toBe(true);
      expect(result.slice('urn:node:'.length)).toBe('hadronmemory.com:dev:conventions:urn-format');
    });
  });
});
