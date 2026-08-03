import { describe, expect, it } from 'vitest';
import { composeNodeUrn } from './compose-node-urn';
import { isFlatV2, parseUrn, parseUrnV2 } from './parse-urn';

describe('composeNodeUrn', () => {
  // cor:urn:010:01 — grammar v2 is flat and single-colon throughout; `::` is
  // the v1 hierarchy separator, which `parseUrnV2` rejects outright. The
  // platform emits v2 (#697/#720), so the portal must too. This reverses the
  // spec-021 FR-009 `:`→`::` rewrite this composer used to perform.
  describe('emits grammar v2 (flat, single colon)', () => {
    it('composes a v1 single-colon memory URN into a flat v2 node URN', () => {
      expect(composeNodeUrn('urn:memory:micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'hrn:node:micromentor.org:mmdata:review:sort-imports',
      );
    });

    it('flattens a v1 `::` memory URN (2 atoms) to v2', () => {
      expect(composeNodeUrn('hrn:memory:hadronmemory.com::dev', 'auth:tokens')).toBe(
        'hrn:node:hadronmemory.com:dev:auth:tokens',
      );
    });

    it('composes from a bare slug-path with no scheme prefix', () => {
      expect(composeNodeUrn('micromentor.org:mmdata', 'review:sort-imports')).toBe(
        'hrn:node:micromentor.org:mmdata:review:sort-imports',
      );
    });

    it('accepts the grammar-v2 hrn:mem: memory URN the server now emits (#697)', () => {
      expect(composeNodeUrn('hrn:mem:acme.com:mmdata', 'review:sort-imports')).toBe(
        'hrn:node:acme.com:mmdata:review:sort-imports',
      );
    });

    it("appends a multi-atom loc verbatim — v2 treats the loc as opaque", () => {
      expect(composeNodeUrn('urn:memory:hadronmemory.com:dev', 'a:b:c:d:e')).toBe(
        'hrn:node:hadronmemory.com:dev:a:b:c:d:e',
      );
    });

    it('preserves a single-segment loc', () => {
      expect(composeNodeUrn('urn:memory:org:mem', 'top')).toBe('hrn:node:org:mem:top');
    });
  });

  // The one case that must NOT be modernized. A >2-atom v1 memory URN is an
  // ownership chain — the shape v2 removed — and per cor:urn:010:01 it has no
  // string-derivable v2 form (migration may reassign slugs; the server resolves
  // it through a stored alias map). Flattening it would let v2's fixed
  // positional arity read atom 1 as the memory slug and fold the rest into the
  // loc, silently addressing a different node.
  describe('ownership chains (>2 atoms) stay in v1 form', () => {
    it('passes a 4-atom install-shape chain through unchanged', () => {
      expect(
        composeNodeUrn(
          'urn:memory:micromentor.org::coding-app::coding-agent::system',
          'review:sort-imports',
        ),
      ).toBe('hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports');
    });

    it('normalizes a single-colon chain to `::` rather than flattening it', () => {
      // Same chain, legacy single-colon spelling. It is still a chain, so it
      // must not be mistaken for a v2 flat URN.
      expect(composeNodeUrn('micromentor.org:coding-app:coding-agent:system', 'pong:notify')).toBe(
        'hrn:node:micromentor.org::coding-app::coding-agent::system::pong:notify',
      );
    });

    it('does NOT emit a v2-parseable URN for a chain (that would be the bug)', () => {
      const chain = composeNodeUrn('micromentor.org::coding-app::system', 'a:b');
      expect(isFlatV2(chain)).toBe(false);
    });
  });

  describe('PK-as-value pass-through (defect lives at caller, not composer)', () => {
    it('accepts a UUIDv7 as value without complaint', () => {
      const uuid = '0190ee19-8b3a-7d4f-b8e1-2f9c8b5d4a3e';
      expect(composeNodeUrn('urn:memory:org:mem', uuid)).toBe(`hrn:node:org:mem:${uuid}`);
    });
  });

  describe('parser round-trip', () => {
    it('non-chain output is canonical grammar v2', () => {
      const result = composeNodeUrn('urn:memory:hadronmemory.com:dev', 'review:sort-imports');
      expect(isFlatV2(result)).toBe(true);
      const parsed = parseUrnV2(result);
      expect(parsed.type).toBe('node');
      expect(parsed.root).toBe('hadronmemory.com');
      expect(parsed.segments).toEqual(['dev', 'review', 'sort-imports']);
    });

    it('non-chain output also still parses under the v1 parser (accepted forever)', () => {
      const result = composeNodeUrn('hadronmemory.com:dev', 'top');
      expect(() => parseUrn(result)).not.toThrow();
      expect(parseUrn(result).type).toBe('node');
    });

    it('chain output parses under the v1 parser', () => {
      const result = composeNodeUrn(
        'urn:memory:micromentor.org::coding-app::coding-agent::system',
        'pong:notify',
      );
      expect(() => parseUrn(result)).not.toThrow();
      expect(parseUrn(result).type).toBe('node');
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
});
