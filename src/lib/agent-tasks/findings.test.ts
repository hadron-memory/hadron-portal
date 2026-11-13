import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FINDINGS_PAGE_SIZE, FINDINGS_PROVIDER_MAX, findingTextParts, nextFindingsOffset, parseFindingsOffset, parseFindingsPage } from './findings';

const f = (id: string, text = 't', severity = 'P2') => ({ id, severity, text });

describe('parseFindingsOffset', () => {
  it.each([[null, 0], ['0', 0], ['20', 20], ['2147483647', 2147483647]])('%s -> %s', (raw, want) => {
    expect(parseFindingsOffset(raw as string | null)).toBe(want);
  });
  it.each(['-1', '1.5', '1e3', ' 1', '', 'abc', '2147483648', '9007199254740992', '0x10', '+1'])('refuses %j', (raw) => {
    expect(parseFindingsOffset(raw)).toBeNull();
  });
});

describe('parseFindingsPage validates the runtime shape, not a cast', () => {
  const ok = { items: [f('F1'), f('F2')], total: 2, hasMore: false };
  it('accepts a legal page, a legacy zero page, and a short page with hasMore', () => {
    expect(parseFindingsPage(ok)).toEqual(ok);
    expect(parseFindingsPage({ items: [], total: 0, hasMore: false })).toEqual({ items: [], total: 0, hasMore: false });
    expect(parseFindingsPage({ items: [f('F1')], total: 57, hasMore: true })).not.toBeNull();
  });
  it.each([
    ['null', null], ['not an object', 'x'], ['items missing', { total: 0, hasMore: false }],
    ['items not an array', { items: {}, total: 0, hasMore: false }],
    ['null item', { items: [null], total: 1, hasMore: false }],
    ['id not a string', { items: [{ id: 1, severity: 'P1', text: 't' }], total: 1, hasMore: false }],
    ['empty id', { items: [f('')], total: 1, hasMore: false }],
    ['severity missing', { items: [{ id: 'F1', text: 't' }], total: 1, hasMore: false }],
    ['text null', { items: [{ id: 'F1', severity: 'P1', text: null }], total: 1, hasMore: false }],
    ['total negative', { ...ok, total: -1 }], ['total fractional', { ...ok, total: 1.5 }], ['total missing', { items: ok.items, hasMore: false }],
    ['hasMore not boolean', { ...ok, hasMore: 'no' }], ['hasMore missing', { items: ok.items, total: 2 }],
    ['empty page claiming more (non-advancing)', { items: [], total: 40, hasMore: true }],
    ['duplicate ids in one page', { items: [f('F1'), f('F1')], total: 2, hasMore: false }],
    ['more rows than the provider maximum', { items: Array.from({ length: FINDINGS_PROVIDER_MAX + 1 }, (_, i) => f(`F${i}`)), total: FINDINGS_PROVIDER_MAX + 1, hasMore: false }],
  ])('refuses %s', (_n, value) => { expect(parseFindingsPage(value)).toBeNull(); });
});

describe('paging arithmetic follows the SERVED page', () => {
  it('asks for 20', () => { expect(FINDINGS_PAGE_SIZE).toBe(20); });
  it('next offset = offset + served items.length, not the requested size', () => {
    expect(nextFindingsOffset({ taskId: 't', offset: 0, items: Array.from({ length: 20 }, (_, i) => f(`F${i}`)), total: 57, hasMore: true })).toBe(20);
    expect(nextFindingsOffset({ taskId: 't', offset: 20, items: Array.from({ length: 7 }, (_, i) => f(`G${i}`)), total: 57, hasMore: true })).toBe(27);
  });
});

describe('findingTextParts: literal text, controls made visible, nothing else touched', () => {
  const join = (s: string) => findingTextParts(s).map((p) => p.text).join('');
  it('plain text, LF and TAB stay literal in one part', () => {
    expect(findingTextParts('a\nb\tc')).toEqual([{ text: 'a\nb\tc', marker: false }]);
  });
  it('shows ESC, CR, DEL, bidi overrides/isolates/marks as code-point markers', () => {
    expect(join('a\u001Bb')).toBe('a[U+001B]b');
    expect(join('a\rb')).toBe('a[U+000D]b');
    expect(join('‮evil‬')).toBe('[U+202E]evil[U+202C]');
    expect(join('x⁦y⁩')).toBe('x[U+2066]y[U+2069]');
    expect(join('‎x‏؜')).toBe('[U+200E]x[U+200F][U+061C]');
    expect(findingTextParts('a\u001Bb').filter((p) => p.marker).map((p) => p.text)).toEqual(['[U+001B]']);
  });
  it('keeps emoji joiners, variation selectors, combining marks and astral text exactly', () => {
    const keep = '👩‍💻 ❤️ é 𝔘𝔫𝔦';
    expect(join(keep)).toBe(keep);
    expect(findingTextParts(keep).some((p) => p.marker)).toBe(false);
  });
  it('is HTML/markdown/link-looking text kept literally (no rewriting)', () => {
    const hostile = '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=1> https://evil.test';
    expect(join(hostile)).toBe(hostile);
  });
  it('keeps all 2000 code points', () => {
    const long = '𝔘'.repeat(2000);
    expect(Array.from(join(long)).length).toBe(2000);
  });
});

// portal#2111 — the characters outside design §15's set that still render blank or smuggle text.
describe('findingTextParts: blank and tag characters are revealed too (portal#2111)', () => {
  const join = (s: string) => findingTextParts(s).map((p) => p.text).join('');
  it.each([
    ['ZERO WIDTH SPACE', '​', '200B'], ['WORD JOINER', '⁠', '2060'], ['BOM / ZWNBSP', '﻿', 'FEFF'],
    ['SOFT HYPHEN', '­', '00AD'], ['MONGOLIAN VOWEL SEPARATOR', '᠎', '180E'],
    ['LANGUAGE TAG', '\u{E0001}', 'E0001'], ['TAG LATIN SMALL A', '\u{E0061}', 'E0061'], ['CANCEL TAG', '\u{E007F}', 'E007F'], ['TAG block start', '\u{E0000}', 'E0000'],
  ])('reveals %s', (_n, ch, hex) => {
    expect(join(`a${ch}b`)).toBe(`a[U+${hex}]b`);
  });
  it('reveals a smuggled ASCII-in-tags payload one code point at a time', () => {
    const smuggled = 'ok' + Array.from('hi', (c) => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('');
    expect(join(smuggled)).toBe('ok[U+E0068][U+E0069]');
  });
  it('keeps a well-formed emoji tag sequence (a subdivision flag) intact', () => {
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(join(`go ${england}!`)).toBe(`go ${england}!`);
    expect(findingTextParts(england).some((p) => p.marker)).toBe(false);
  });
  it('still keeps the zero-width joiner and non-joiner that real scripts need', () => {
    expect(join('a‍b‌c')).toBe('a‍b‌c');
  });
});

describe('the neutralizer source is auditable (portal#2111)', () => {
  it('REVEALED is written with escapes only, never literal invisible characters', () => {
    const line = readFileSync('src/lib/agent-tasks/findings.ts', 'utf8').split('\n').find((l) => l.includes('const REVEALED'));
    expect(line).toBeDefined();
    expect(line!).toMatch(/^[\x20-\x7E]*$/);
  });
});

