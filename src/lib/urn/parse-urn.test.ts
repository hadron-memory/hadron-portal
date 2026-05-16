import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseDisplayUrn as parseUrn,
  parseUrn as parseCanonicalUrn,
  toParserCanonical,
  isParserCanonical,
  validateUserSlug,
  UrnParseError,
  type AliasCategory,
} from './parse-urn';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('parseDisplayUrn (spec 010)', () => {
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

// =====================================================================
// Spec 021 — canonical-form parser parity with hadron-server
//
// Every record in parser-golden-set.json is asserted against this
// portal's parseUrn() implementation. The fixture is sha256-matched
// across hadron-server / hadron-portal / hadron-client (T002-T004); CI
// drift gate (T005) blocks divergence.
// =====================================================================

interface GoldenCase {
  _section?: string;
  _note?: string;
  input: string;
  expectedType?: string;
  expectedParserCanonical?: string;
  expectedParserRewrites?: AliasCategory[];
  expectedNeedsResolver?: boolean;
  expectedReject?: string;
  offendingSegment?: string;
}

const goldenSet: { cases: GoldenCase[] } = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/parser-golden-set.json'), 'utf-8'),
);
const goldenCases: GoldenCase[] = goldenSet.cases.filter(c => c.input !== undefined);

describe('parseUrn (spec 021) — golden-set parity', () => {
  for (const c of goldenCases) {
    const label = c.expectedReject
      ? `[reject:${c.expectedReject}] ${c.input}`
      : `${c.input} → ${c.expectedParserCanonical}`;
    it(label, () => {
      if (c.expectedReject) {
        try {
          parseCanonicalUrn(c.input);
          throw new Error(`Expected UrnParseError(${c.expectedReject}) but parsing succeeded`);
        } catch (e) {
          expect(e).toBeInstanceOf(UrnParseError);
          expect((e as UrnParseError).reason).toBe(c.expectedReject);
          if (c.offendingSegment) {
            expect((e as UrnParseError).offendingSegment).toBe(c.offendingSegment);
          }
          expect((e as UrnParseError).input).toBe(c.input);
        }
        return;
      }
      const result = parseCanonicalUrn(c.input);
      expect(result.type).toBe(c.expectedType);
      expect(result.parserCanonical).toBe(c.expectedParserCanonical);
      const got = [...result.parserRewrites].sort();
      const exp = [...(c.expectedParserRewrites ?? [])].sort();
      expect(got).toEqual(exp);
      expect(result.needsResolverCanonicalization).toBe(c.expectedNeedsResolver === true);
      // Idempotence
      const reparsed = parseCanonicalUrn(result.parserCanonical);
      expect(reparsed.parserCanonical).toBe(result.parserCanonical);
      expect(reparsed.parserRewrites).toEqual([]);
    });
  }
});

describe('parseCanonicalUrn — case sensitivity (D9)', () => {
  it('preserves slug case in parserCanonical', () => {
    expect(parseCanonicalUrn('urn:agent:Hadronmemory.com::Coding-Agent').parserCanonical).toBe(
      'urn:agent:Hadronmemory.com::Coding-Agent',
    );
  });

  it('treats slugs differing only in case as different URNs', () => {
    const a = parseCanonicalUrn('urn:agent:acme.com::Coding-Agent');
    const b = parseCanonicalUrn('urn:agent:acme.com::coding-agent');
    expect(a.parserCanonical).not.toBe(b.parserCanonical);
  });
});

describe('toParserCanonical / isParserCanonical', () => {
  it('toParserCanonical rewrites non-canonical to canonical', () => {
    expect(
      toParserCanonical('urn:agent:micromentor.org::app:coding-app::agent:hadronmemory.com:coding-agent'),
    ).toBe('urn:agent:micromentor.org::coding-app::hadronmemory.com:coding-agent');
  });

  it('toParserCanonical is idempotent', () => {
    const once = toParserCanonical('urn:agent:micromentor.org::app:coding-app');
    expect(toParserCanonical(once)).toBe(once);
  });

  it('isParserCanonical returns true for canonical inputs', () => {
    expect(isParserCanonical('urn:agent:hadronmemory.com::coding-agent')).toBe(true);
  });

  it('isParserCanonical returns false for inputs needing rewrites', () => {
    expect(
      isParserCanonical('urn:agent:micromentor.org::app:coding-app'),
    ).toBe(false);
  });

  it('isParserCanonical returns false for inputs that fail to parse', () => {
    expect(isParserCanonical('not-a-urn')).toBe(false);
    expect(isParserCanonical('urn:loc:foo')).toBe(false);
  });
});

describe('validateUserSlug (FR-019)', () => {
  it('accepts a simple slug', () => {
    expect(() => validateUserSlug('coding-agent')).not.toThrow();
  });

  it('accepts a domain-name slug', () => {
    expect(() => validateUserSlug('a.b.c.com')).not.toThrow();
  });

  it('rejects "system" as reserved', () => {
    expect(() => validateUserSlug('system')).toThrow(UrnParseError);
  });

  it('rejects "Agent" (mixed-case) as reserved', () => {
    expect(() => validateUserSlug('Agent')).toThrow(UrnParseError);
  });

  it('rejects whitespace as invalid-charset', () => {
    try {
      validateUserSlug('foo bar');
    } catch (e) {
      expect((e as UrnParseError).reason).toBe('invalid-charset');
    }
  });

  it('rejects 65-char slug as slug-too-long', () => {
    try {
      validateUserSlug('x'.repeat(65));
    } catch (e) {
      expect((e as UrnParseError).reason).toBe('slug-too-long');
    }
  });
});

// hadron-client PR #9 Copilot review: stripTypeMarkers used to strip
// at every segment INCLUDING index 0 (the org slot). A malformed URN
// like `urn:agent:app:micromentor.org::coding-agent` would have its
// `app:` stripped from segments[0] before validation, silently
// canonicalizing. The fix skips index 0; the first-segment-must-be-
// one-atom validator now catches this. Same bug existed in the portal's
// parser (the code was ported from hadron-server); this locks the fix.
describe('parseCanonicalUrn — type-markers are NOT stripped from the org segment (index 0)', () => {
  it('rejects urn:agent:app:org::slug as invalid-segment-shape', () => {
    try {
      parseCanonicalUrn('urn:agent:app:micromentor.org::coding-agent');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UrnParseError);
      expect((e as UrnParseError).reason).toBe('invalid-segment-shape');
      expect((e as UrnParseError).offendingSegment).toBe('app:micromentor.org');
    }
  });

  it('rejects urn:memory:memory:org::slug::role', () => {
    expect(() =>
      parseCanonicalUrn('urn:memory:memory:micromentor.org::coding-agent::system'),
    ).toThrow(UrnParseError);
  });

  it('rejects urn:agent:agent:org::slug', () => {
    expect(() =>
      parseCanonicalUrn('urn:agent:agent:micromentor.org::coding-agent'),
    ).toThrow(UrnParseError);
  });
});

describe('parseCanonicalUrn — node-leaf locs are NOT mangled by cat 4 strip', () => {
  // Cross-repo regression test for hadron-server's Codex-#3 fix.
  it('preserves a node leaf that begins with a type-marker word', () => {
    const r = parseCanonicalUrn(
      'urn:node:micromentor.org::coding-app::coding-agent::system::app:settings',
    );
    expect(r.parserCanonical).toBe(
      'urn:node:micromentor.org::coding-app::coding-agent::system::app:settings',
    );
    expect(r.parserRewrites).toEqual([]);
  });
});
