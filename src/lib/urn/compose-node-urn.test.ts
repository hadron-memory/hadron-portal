import { describe, expect, it } from 'vitest';
import { composeNodeUrn } from './compose-node-urn';
import { parseUrn } from './parse-urn';

describe('composeNodeUrn', () => {
  describe('happy path (spec 021 — `::` hierarchy separator)', () => {
    // Codex review on PR #222 caught that legacy single-`:` memory URNs
    // produced spec-021-INVALID node URNs (the first segment ended up
    // with two atoms, failing the "first segment must be one atom"
    // rule). composeNodeUrn now auto-converts every `:` in legacy
    // slug-paths to `::` so the output is always spec-021-parseable.
    it('composes with prefixed legacy-shape memory URN — auto-converts `:` to `::`', () => {
      expect(composeNodeUrn('urn:memory:micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'hrn:node:micromentor.org::mmdata::review:sort-imports',
      );
    });

    it('composes with prefixed spec-021-shape memory URN — pass-through', () => {
      expect(
        composeNodeUrn(
          'urn:memory:micromentor.org::coding-app::coding-agent::system',
          'review:sort-imports',
        ),
      ).toBe(
        'hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports',
      );
    });

    it('composes with bare legacy slug-path memory URN (no urn:memory: prefix)', () => {
      expect(composeNodeUrn('micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'hrn:node:micromentor.org::mmdata::review:sort-imports',
      );
    });

    it('preserves all loc segments when loc has multiple internal colons', () => {
      expect(composeNodeUrn('urn:memory:hadronmemory.com:dev', 'a:b:c:d:e')).toBe(
        'hrn:node:hadronmemory.com::dev::a:b:c:d:e',
      );
    });

    it('preserves a single-segment loc', () => {
      expect(composeNodeUrn('urn:memory:org:mem', 'top')).toBe('hrn:node:org::mem::top');
    });
  });

  describe('PK-as-value pass-through (defect lives at caller, not composer)', () => {
    it('accepts a UUIDv7 as value without complaint', () => {
      const uuid = '0190ee19-8b3a-7d4f-b8e1-2f9c8b5d4a3e';
      expect(composeNodeUrn('urn:memory:org:mem', uuid)).toBe(`hrn:node:org::mem::${uuid}`);
    });
  });

  // Codex regression: composeNodeUrn must produce output that parseUrn
  // (the spec-021 parser) accepts. The pre-fix version silently emitted
  // invalid URNs for legacy-shape memory inputs.
  describe('parser round-trip (composeNodeUrn output is always spec-021-parseable)', () => {
    it('legacy memory URN + loc → output passes parseUrn', () => {
      const result = composeNodeUrn(
        'urn:memory:hadronmemory.com:dev',
        'review:sort-imports',
      );
      expect(() => parseUrn(result)).not.toThrow();
      const parsed = parseUrn(result);
      expect(parsed.type).toBe('node');
    });

    it('spec-021 memory URN + loc → output passes parseUrn', () => {
      const result = composeNodeUrn(
        'urn:memory:micromentor.org::coding-app::coding-agent::system',
        'pong:notify',
      );
      expect(() => parseUrn(result)).not.toThrow();
      const parsed = parseUrn(result);
      expect(parsed.type).toBe('node');
    });

    it('bare legacy slug-path + loc → output passes parseUrn', () => {
      const result = composeNodeUrn('hadronmemory.com:dev', 'top');
      expect(() => parseUrn(result)).not.toThrow();
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

  describe('shape', () => {
    it('produces a URN starting with hrn:node: prefix', () => {
      const result = composeNodeUrn(
        'urn:memory:hadronmemory.com:dev',
        'conventions:urn-format',
      );
      expect(result.startsWith('hrn:node:')).toBe(true);
      // After auto-conversion the slug-path is `hadronmemory.com::dev`,
      // joined with the loc by `::`.
      expect(result.slice('hrn:node:'.length)).toBe(
        'hadronmemory.com::dev::conventions:urn-format',
      );
    });

    it('round-trips a spec-021-shape memory URN cleanly', () => {
      const result = composeNodeUrn(
        'urn:memory:micromentor.org::coding-app::coding-agent::system',
        'pong:notify',
      );
      expect(result).toBe(
        'hrn:node:micromentor.org::coding-app::coding-agent::system::pong:notify',
      );
    });
  });
});
