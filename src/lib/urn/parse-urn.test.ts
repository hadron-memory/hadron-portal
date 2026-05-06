import { describe, expect, it } from 'vitest';
import { parseUrn } from './parse-urn';

describe('parseUrn', () => {
  describe('US2 — auto-detected type from urn: prefix', () => {
    it('detects org', () => {
      const r = parseUrn('urn:org:micromentor.org');
      expect(r.type).toBe('org');
      expect(r.bareValue).toBe('micromentor.org');
      expect(r.fullUrn).toBe('urn:org:micromentor.org');
    });

    it('detects memory', () => {
      const r = parseUrn('urn:memory:micromentor.org:mmdata');
      expect(r.type).toBe('memory');
      expect(r.bareValue).toBe('micromentor.org:mmdata');
      expect(r.fullUrn).toBe('urn:memory:micromentor.org:mmdata');
    });

    it('detects agent', () => {
      const r = parseUrn('urn:agent:micromentor.org:mmcoding-agent');
      expect(r.type).toBe('agent');
      expect(r.bareValue).toBe('micromentor.org:mmcoding-agent');
    });

    it('detects app', () => {
      const r = parseUrn('urn:app:micromentor.org:mmcoding');
      expect(r.type).toBe('app');
      expect(r.bareValue).toBe('micromentor.org:mmcoding');
    });

    it('detects node and preserves all colon-separated bare segments', () => {
      const r = parseUrn('urn:node:micromentor.org:mmdata:review:sort-imports');
      expect(r.type).toBe('node');
      expect(r.bareValue).toBe('micromentor.org:mmdata:review:sort-imports');
      expect(r.fullUrn).toBe('urn:node:micromentor.org:mmdata:review:sort-imports');
    });
  });

  describe('US3 — bare value preserves all colon segments', () => {
    it('full bare value (used by compact-mode rendering) keeps memory-context for nodes', () => {
      const r = parseUrn('urn:node:micromentor.org:mmdata:review:sort-imports');
      // Adjacent compact-mode renderings would show this string directly;
      // dropping all but the last segment (pre-010 behavior) collapsed
      // distinct nodes to identical text.
      expect(r.bareValue).toBe('micromentor.org:mmdata:review:sort-imports');
    });

    it('two URNs differing only in memory segment yield distinct bare values', () => {
      const a = parseUrn('urn:node:org-a:mem-a:review:sort-imports');
      const b = parseUrn('urn:node:org-b:mem-b:review:sort-imports');
      expect(a.bareValue).not.toBe(b.bareValue);
    });
  });

  describe('US4 — fallback to unknown when no type can be determined', () => {
    it('renders as unknown when value has no urn: prefix and no typeProp', () => {
      const r = parseUrn('abc-123');
      expect(r.type).toBe('unknown');
      expect(r.bareValue).toBe('abc-123');
      expect(r.fullUrn).toBe('urn:unknown:abc-123');
    });

    it('typeProp wins over unknown fallback', () => {
      const r = parseUrn('abc-123', 'node');
      expect(r.type).toBe('node');
      expect(r.bareValue).toBe('abc-123');
      expect(r.fullUrn).toBe('urn:node:abc-123');
    });

    it('embedded prefix wins over typeProp (preserves pre-010 component behavior)', () => {
      // Caller passed type='node' but value already declares type='memory'.
      // The embedded type wins — this is intentional, callers sometimes
      // pass a generic type while the value carries a more specific one.
      const r = parseUrn('urn:memory:org:mem', 'node');
      expect(r.type).toBe('memory');
      expect(r.bareValue).toBe('org:mem');
    });

    it('unrecognized urn:<word>: prefix falls through to unknown', () => {
      // Only org/memory/agent/app/node are recognized today.
      const r = parseUrn('urn:something:foo');
      expect(r.type).toBe('unknown');
      expect(r.bareValue).toBe('urn:something:foo');
      expect(r.fullUrn).toBe('urn:unknown:urn:something:foo');
    });
  });

  describe('US2/US3 invariant — fullUrn always has urn:<type>: prefix', () => {
    const cases: string[] = [
      'urn:agent:org:agent',
      'urn:memory:org:mem',
      'urn:node:org:mem:loc',
      'bare-value-with-no-prefix',
    ];
    for (const value of cases) {
      it(`fullUrn for '${value}' starts with 'urn:'`, () => {
        const r = parseUrn(value);
        expect(r.fullUrn.startsWith('urn:')).toBe(true);
      });
    }
  });
});
