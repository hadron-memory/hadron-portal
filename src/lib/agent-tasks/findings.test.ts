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
    expect(join('\u202Eevil\u202C')).toBe('[U+202E]evil[U+202C]');
    expect(join('x\u2066y\u2069')).toBe('x[U+2066]y[U+2069]');
    expect(join('\u200Ex\u200F\u061C')).toBe('[U+200E]x[U+200F][U+061C]');
    expect(findingTextParts('a\u001Bb').filter((p) => p.marker).map((p) => p.text)).toEqual(['[U+001B]']);
  });
  it('keeps emoji joiners, variation selectors, combining marks and astral text exactly', () => {
    const keep = '👩\u200D💻 ❤\uFE0F e\u0301 𝔘𝔫𝔦';
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
    ['ZERO WIDTH SPACE', '\u200B', '200B'], ['WORD JOINER', '\u2060', '2060'], ['BOM / ZWNBSP', '\uFEFF', 'FEFF'],
    ['SOFT HYPHEN', '\u00AD', '00AD'], ['MONGOLIAN VOWEL SEPARATOR', '\u180E', '180E'],
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
    const joined = 'a\u200Db\u200Cc';
    expect(joined.length).toBe(5); // a stripped joiner fails here instead of passing vacuously
    expect(join(joined)).toBe(joined);
    expect(findingTextParts(joined).some((p) => p.marker)).toBe(false);
  });
});

describe('the neutralizer source is auditable (portal#2111, portal#2113)', () => {
  // Resolved from this test file, not the working directory. Line endings are normalized here rather than
  // with a repo-wide .gitattributes (portal#2118 F3): a CRLF checkout must not read as hidden U+000D.
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const hiddenIn = (text: string) => findingTextParts(text).filter((p) => p.marker).map((p) => p.text);
  const source = lf(readFileSync(new URL('./findings.ts', import.meta.url), 'utf8'));
  it('REVEALED is written with escapes only, never literal invisible characters', () => {
    const line = source.split('\n').find((l) => l.includes('const REVEALED'));
    expect(line).toBeDefined();
    expect(line!).toMatch(/^[\x20-\x7E]*$/);
  });
  it('the whole source holds no character the neutralizer would reveal', () => {
    expect(hiddenIn(source)).toEqual([]);
  });
  it('a CRLF checkout passes the audit once normalized, and would not without it (portal#2118 F3)', () => {
    const crlf = source.replace(/\n/g, '\r\n');
    expect(crlf).not.toBe(source);
    expect(hiddenIn(lf(crlf))).toEqual([]);
    // Every line ending is a revealed U+000D, not just the first (portal#2125 item 7).
    const markers = hiddenIn(crlf);
    expect(markers).toEqual(Array(source.split('\n').length - 1).fill('[U+000D]'));
  });
  it('control: one injected U+202E anywhere in the source is caught', () => {
    // Anchored on the declaration the audit exists for, not on prose (portal#2118 F1).
    const injected = source.replace('const REVEALED', '\u202Econst REVEALED');
    expect(injected).not.toBe(source);
    expect(hiddenIn(injected)).toEqual(['[U+202E]']);
  });
});

// portal#2113 A1 — invisible operators and line/paragraph separators render blank or break a line unseen.
describe('findingTextParts: invisible operators and separators are revealed (portal#2113 A1)', () => {
  const join = (s: string) => findingTextParts(s).map((p) => p.text).join('');
  it.each([
    ['FUNCTION APPLICATION', '\u2061', '2061'], ['INVISIBLE TIMES', '\u2062', '2062'], ['INVISIBLE SEPARATOR', '\u2063', '2063'],
    ['INVISIBLE PLUS', '\u2064', '2064'], ['LINE SEPARATOR', '\u2028', '2028'], ['PARAGRAPH SEPARATOR', '\u2029', '2029'],
  ])('reveals %s', (_n, ch, hex) => {
    expect(ch).toHaveLength(1);
    expect(join(`a${ch}b`)).toBe(`a[U+${hex}]b`);
  });
  // portal#2118 F4/F5: U+2065 is unassigned but Default_Ignorable, so a browser draws nothing for it,
  // the same hiding vector as its neighbours. portal#2124: U+206A-206F are assigned but deprecated
  // format characters (Cf: symmetric swapping, Arabic form shaping, digit shapes), also drawn as
  // nothing, so they are revealed too. The whole block U+2060-206F is pinned.
  it('reveals every code point U+2060 through U+206F, U+2065 and U+206A-206F included', () => {
    for (let cp = 0x2060; cp <= 0x206F; cp++) {
      const hex = cp.toString(16).toUpperCase();
      expect(join(`a${String.fromCodePoint(cp)}b`), hex).toBe(`a[U+${hex}]b`);
    }
  });
  it('control: the visible neighbours just outside the block are not revealed', () => {
    for (const cp of [0x205E, 0x2070]) { // VERTICAL FOUR DOTS, SUPERSCRIPT ZERO
      const ch = String.fromCodePoint(cp);
      expect(join(`a${ch}b`), cp.toString(16)).toBe(`a${ch}b`);
    }
  });
});

// portal#2128 — the space separators (Zs) are ordinary text and deliberately NOT revealed. A characterization pin.
describe('findingTextParts: Unicode space separators pass through unchanged (portal#2128)', () => {
  // U+2000-U+200A is 11 code points.
  const ZS = [0x20, 0xA0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x202F, 0x205F, 0x3000];
  const label = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0');
  // one test per code point: several Zs characters are indistinguishable blanks, so a failure must name the one
  it.each(ZS.map((cp) => [`U+${label(cp)}`, cp] as const))('renders %s unchanged, as one unmarked part', (_name, cp) => {
    const ch = String.fromCodePoint(cp);
    expect(findingTextParts(`a${ch}b`)).toEqual([{ text: `a${ch}b`, marker: false }]);
  });
  it('keeps a Zs next to a revealed U+200B: only the U+200B is marked', () => {
    expect(findingTextParts('\u200B\u00A0').map((p) => [p.text, p.marker])).toEqual([['[U+200B]', true], ['\u00A0', false]]);
    expect(findingTextParts('\u00A0\u200B').map((p) => [p.text, p.marker])).toEqual([['\u00A0', false], ['[U+200B]', true]]);
  });
  it('keeps a Zs at the start and at the end of the string', () => {
    expect(findingTextParts('\u3000ab')).toEqual([{ text: '\u3000ab', marker: false }]);
    expect(findingTextParts('ab\u3000')).toEqual([{ text: 'ab\u3000', marker: false }]);
    expect(findingTextParts('\u00A0')).toEqual([{ text: '\u00A0', marker: false }]);
  });
  it('the list is the whole Zs category of the Unicode version in use (a new Zs code point must be decided, not missed)', () => {
    const all: number[] = [];
    for (let cp = 0; cp <= 0x10FFFF; cp++) if (/^\p{Zs}$/u.test(String.fromCodePoint(cp))) all.push(cp);
    expect(all).toEqual(ZS);
  });
  it('U+205F, between the revealed block and the visible punctuation U+205E, is not revealed', () => {
    expect(findingTextParts('a\u205Fb')).toEqual([{ text: 'a\u205Fb', marker: false }]);
  });
});

// portal#2113 A2 — the kept emoji tag sequence stays bounded: black flag, 1-6 lowercase tag letters/digits, CANCEL TAG.
describe('findingTextParts: the kept tag sequence is exactly bounded (portal#2113 A2)', () => {
  const join = (s: string) => findingTextParts(s).map((p) => p.text).join('');
  const FLAG = '\u{1F3F4}';
  const CANCEL = '\u{E007F}';
  const tags = (ascii: string) => Array.from(ascii, (c) => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('');
  const markers = (ascii: string) => Array.from(ascii, (c) => `[U+${(0xE0000 + c.charCodeAt(0)).toString(16).toUpperCase()}]`).join('');
  it('seven tags + CANCEL reveal every tag and the CANCEL (kills an unbounded or widened upper bound)', () => {
    expect(join(FLAG + tags('gbengxx') + CANCEL)).toBe(FLAG + markers('gbengxx') + '[U+E007F]');
  });
  it('uppercase tags are not in the kept class and are revealed (kills widening to E0041-E005A)', () => {
    expect(join(FLAG + tags('GBENG') + CANCEL)).toBe(FLAG + markers('GBENG') + '[U+E007F]');
  });
  it('tags without a CANCEL TAG are revealed (kills an optional CANCEL)', () => {
    expect(join(FLAG + tags('gbeng'))).toBe(FLAG + markers('gbeng'));
  });
  it('positive control: six tags + CANCEL stay whole (kills an off-by-one upper bound)', () => {
    const six = FLAG + tags('gbengx') + CANCEL;
    expect(join(six)).toBe(six);
    expect(findingTextParts(six).some((p) => p.marker)).toBe(false);
  });
  it('positive control: one tag + CANCEL stays whole (kills an off-by-one lower bound)', () => {
    const one = FLAG + tags('g') + CANCEL;
    expect(findingTextParts(one).some((p) => p.marker)).toBe(false);
  });
});

