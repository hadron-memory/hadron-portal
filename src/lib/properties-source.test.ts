/**
 * #886 — what the Properties Source view accepts, and when two bags are "the
 * same" for the stale-page check.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, parsePropertiesSource, PROPERTIES_MAX, sameProperties } from './properties-source';

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
