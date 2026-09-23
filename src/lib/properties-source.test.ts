/**
 * #886 — what the Properties Source view accepts, and when two bags are "the
 * same" for the stale-page check.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  isFingerprint,
  parsePropertiesSource,
  propertiesFingerprint,
  PROPERTIES_MAX,
  PROPERTIES_MAX_DEPTH,
  sameProperties,
  scanSource,
  utf8Length,
  inexactNumber,
} from './properties-source';

describe('parsePropertiesSource', () => {
  it('accepts a JSON object, including {} — the explicit "no properties"', () => {
    expect(parsePropertiesSource('{"a": 1, "exports": {"claudeSkill": {"enable": true}}}')).toEqual({
      ok: true,
      value: { a: 1, exports: { claudeSkill: { enable: true } } },
    });
    expect(parsePropertiesSource('  {}  ')).toEqual({ ok: true, value: {} });
  });

  it('refuses empty text rather than reading it as "clear everything"', () => {
    expect(parsePropertiesSource('   \n ')).toEqual({ ok: false, code: 'empty' });
  });

  it.each([
    ['an array', '[1, 2]'],
    ['a string', '"x"'],
    ['a number', '42'],
    ['a bare null', 'null'],
  ])('refuses %s — properties is a JSON OBJECT', (_what, raw) => {
    expect(parsePropertiesSource(raw)).toEqual({ ok: false, code: 'not-object' });
  });

  it('reports a syntax error with the parser\'s own message', () => {
    const r = parsePropertiesSource('{"a": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-json');
      expect(r.detail).toEqual(expect.any(String));
    }
  });

  it('refuses a paste over the cap before parsing it', () => {
    const big = `{"k": "${'x'.repeat(PROPERTIES_MAX)}"}`;
    expect(parsePropertiesSource(big)).toEqual({ ok: false, code: 'too-large' });
  });
});

describe('sameProperties — the stale-page comparison', () => {
  it('ignores key ORDER at every depth — JSONB does not keep it, so it is not a change', () => {
    expect(sameProperties({ a: 1, b: { y: 2, x: 1 } }, { b: { x: 1, y: 2 }, a: 1 })).toBe(true);
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  it('keeps array order — that IS meaningful', () => {
    expect(sameProperties({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it('treats null, absent and {} as the same empty bag', () => {
    expect(sameProperties(null, {})).toBe(true);
    expect(sameProperties(undefined, null)).toBe(true);
    expect(sameProperties({}, { a: 1 })).toBe(false);
  });

  it('sees a one-flag change deep inside exports', () => {
    const on = { exports: { claudeSkill: { name: 'x', enable: true } } };
    const off = { exports: { claudeSkill: { name: 'x', enable: false } } };
    expect(sameProperties(on, off)).toBe(false);
  });
});

describe('numbers JSON cannot carry back EXACTLY (@codex on #893, twice)', () => {
  it.each([
    ['an overflow — parses to Infinity, sent as null', '{"a": {"huge": 1e400}}', '1e400'],
    ['an integer past 2^53 — rounded', '{"ids": [1, 12345678901234567890]}', '12345678901234567890'],
    ['a fraction with more precision than a double — rounded', '{"ratio": 1.234567890123456789}', '1.234567890123456789'],
    ['an underflow — becomes 0', '{"tiny": 1e-400}', '1e-400'],
  ])('refuses %s, naming the literal', (_what, raw, literal) => {
    expect(parsePropertiesSource(raw)).toEqual({ ok: false, code: 'unsafe-number', detail: literal });
  });

  it.each([
    ['ordinary values', '{"a": 0.1, "b": -3, "c": 1.5e-7, "d": 5e-324}'],
    ['the largest safe integer', `{"n": ${Number.MAX_SAFE_INTEGER}}`],
    ['spellings of the same value', '{"a": 1.0, "b": 1e2, "c": 0.10, "d": 1E+21, "e": -0}'],
    ['digits inside strings', '{"s": "1.234567890123456789 and 1e400", "t": "\\"12345678901234567890\\""}'],
  ])('accepts %s', (_what, raw) => {
    expect(parsePropertiesSource(raw).ok).toBe(true);
  });

  it('stays linear on a large bag of numbers', () => {
    const raw = `{"xs": [${Array.from({ length: 20_000 }, (_, k) => k + 0.5).join(',')}]}`;
    const start = performance.now();
    expect(inexactNumber(raw)).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('the size cap counts BYTES (@codex on #893)', () => {
  it('refuses non-Latin text under the cap in characters but over it in UTF-8 bytes', () => {
    // 100K three-byte characters: 100K chars, ~300 KB on the wire.
    const text = `{"k": "${'語'.repeat(100_000)}"}`;
    expect(text.length).toBeLessThan(PROPERTIES_MAX);
    expect(parsePropertiesSource(text)).toEqual({ ok: false, code: 'too-large' });
  });
});

describe('propertiesFingerprint — the posted baseline', () => {
  it('is SHA-256 of the canonical JSON — pinned, so page and action cannot drift apart', async () => {
    // sha256("{}")
    expect(await propertiesFingerprint({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('agrees with sameProperties: key order and null ≡ {} do not change it, a flag does', async () => {
    expect(await propertiesFingerprint({ a: 1, b: { y: 2, x: 1 } })).toBe(await propertiesFingerprint({ b: { x: 1, y: 2 }, a: 1 }));
    expect(await propertiesFingerprint(null)).toBe(await propertiesFingerprint({}));
    expect(await propertiesFingerprint({ e: { enable: true } })).not.toBe(await propertiesFingerprint({ e: { enable: false } }));
    expect(isFingerprint(await propertiesFingerprint({ a: 1 }))).toBe(true);
    expect(isFingerprint('{"a":1}')).toBe(false);
  });
});

describe('nesting depth (@codex on #893)', () => {
  it('refuses a pathological nesting BEFORE anything recursive sees it — no stack overflow', () => {
    const deep = '{"a":'.repeat(5000) + '1' + '}'.repeat(5000);
    expect(utf8Length(deep)).toBeLessThan(PROPERTIES_MAX);
    expect(parsePropertiesSource(deep)).toEqual({ ok: false, code: 'too-deep' });
  });

  it('accepts nesting up to the limit, and counts brackets inside strings as text', () => {
    const atLimit = '{"a":'.repeat(PROPERTIES_MAX_DEPTH) + '1' + '}'.repeat(PROPERTIES_MAX_DEPTH);
    expect(parsePropertiesSource(atLimit).ok).toBe(true);
    const overLimit = '{"a":'.repeat(PROPERTIES_MAX_DEPTH + 1) + '1' + '}'.repeat(PROPERTIES_MAX_DEPTH + 1);
    expect(parsePropertiesSource(overLimit)).toEqual({ ok: false, code: 'too-deep' });
    expect(parsePropertiesSource(`{"s": "${'['.repeat(200)}"}`).ok).toBe(true);
    expect(scanSource('{"a": [[1]]}').depth).toBe(3);
  });
});

describe('canonicalJson is iterative (@codex on #893)', () => {
  const deepValue = (n: number) => {
    let v: unknown = 1;
    for (let k = 0; k < n; k++) v = { a: v };
    return v;
  };

  it('canonicalizes a bag nested far past any stack limit — a STORED bag is never depth-checked', async () => {
    const v = deepValue(20_000);
    expect(() => canonicalJson(v)).not.toThrow();
    expect(sameProperties(v, deepValue(20_000))).toBe(true);
    await expect(propertiesFingerprint(v)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches JSON.stringify over a key-sorted copy, including its edge cases', () => {
    const cases: unknown[] = [
      { b: 1, a: [3, { d: null, c: 'x' }] },
      [],
      {},
      'str',
      0,
      null,
      { u: undefined, f: () => 1, keep: true },
      [undefined, () => 1, Infinity, NaN],
      { 'quote"key': 'v', 'ünï': [true, false] },
    ];
    const sorted = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.map(sorted)
        : x !== null && typeof x === 'object'
          ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])]))
          : x;
    for (const c of cases) expect(canonicalJson(c)).toBe(JSON.stringify(sorted(c)));
  });
});

describe('duplicate keys (@codex on #893)', () => {
  it.each([
    ['at the top level', '{"exports": {"enable": true}, "exports": {"enable": false}}', 'exports'],
    ['inside a nested object', '{"a": {"x": 1, "y": 2, "x": 3}}', 'x'],
    ['spelled with an escape', '{"a": 1, "\\u0061": 2}', 'a'],
  ])('refuses a duplicate %s, naming the key', (_where, raw, key) => {
    expect(parsePropertiesSource(raw)).toEqual({ ok: false, code: 'duplicate-key', detail: key });
  });

  it.each([
    ['the same key in SIBLING objects', '{"a": {"k": 1}, "b": {"k": 2}}'],
    ['the same key at different depths', '{"k": {"k": 1}}'],
    ['a key-like string as a VALUE', '{"k": "k", "j": ["k", "k"]}'],
    ['objects inside an array', '{"xs": [{"k": 1}, {"k": 2}]}'],
  ])('accepts %s', (_what, raw) => {
    expect(parsePropertiesSource(raw).ok).toBe(true);
  });
});
