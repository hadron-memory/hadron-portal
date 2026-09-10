import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { blankComments, findUnsafeInterpolation, sourceFilesUnder } from './check-unsafe-interpolation.mjs';

/**
 * #817 — the gate's own test.
 *
 * The silences matter more than the flags here: this check exempts comments,
 * and that exemption is exactly where a real defect could hide
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 * So each silence is stated, and the comment exemption is pinned to the shapes
 * that actually appear in `src/`.
 */
describe('findUnsafeInterpolation', () => {
  it.each([
    ['a single-quoted placeholder', `t('a', 'Download {file}').replace('{file}', name)`],
    ['a double-quoted placeholder', `t("a", "Download {file}").replace("{file}", name)`],
    ['a global regex placeholder', `t('a', '{shown} of {shown}').replace(/\\{shown\\}/g, n)`],

    ['spacing inside the call', `x.replace( '{a}' , a)`],
  ])('flags %s', (_what, line) => {
    expect(findUnsafeInterpolation(line)).toHaveLength(1);
  });

  // A chain reports EVERY link, not just the first: each is independently
  // unsafe, and fixing one and missing the other is the shape of half a sweep.
  it('flags every link of a chain', () => {
    expect(findUnsafeInterpolation(`x.replace('{a}', a).replace('{b}', b)`)).toHaveLength(2);
  });

  // The callback form is SAFE — its return value is used verbatim — but it is
  // still the per-call-site remedy #817 replaced, so it is flagged: the point
  // of the boundary is that there is one door, not two.
  it('flags even the safe callback form, because the boundary is the rule', () => {
    expect(findUnsafeInterpolation(`t('a', 'x {n}').replace('{n}', () => String(v))`)).toHaveLength(1);
  });

  it.each([
    ['the swept form', `t('a', 'Download {file}', { file: name })`],
    ['fill()', `fill(strings.title, { target: ref.target })`],
    ['an unrelated replace', `slug.replace('/', '-')`],
    ['a replace with no placeholder braces', `s.replace('foo', bar)`],
  ])('stays silent on %s', (_what, line) => {
    expect(findUnsafeInterpolation(line)).toEqual([]);
  });

  // The exemption that has to exist: the clearest way to document this defect
  // is to show the broken call, and `src/` does exactly that in two places.
  it.each([
    ['a line comment', `  //   'Signature: {sig}'.replace('{sig}', 'Eicar$&Test')  → corrupted`],
    [
      'a block-comment continuation',
      // The WHOLE comment, not a lone ` * ` line: the scanner is stateful over
      // the file, so a fragment with no opener is not a comment and should not
      // be treated as one. The old line-based version judged fragments, which
      // is precisely how it mistook a URL for a comment start.
      `/**\n * holder would want \`t(...).replace('{who}', handle)\`, and that expands $&\n */`,
    ],
    ['a trailing comment', `const x = 1; // was .replace('{a}', a)`],
  ])('stays silent on %s', (_what, line) => {
    expect(findUnsafeInterpolation(line)).toEqual([]);
  });

  it('still flags code that merely sits near a comment', () => {
    expect(findUnsafeInterpolation(`x.replace('{a}', a); // fix me`)).toHaveLength(1);
  });
});

/**
 * Both #830 review findings were about the CHECK rather than the sweep, and
 * both made it pass over live defects — which is worse than no gate, because it
 * is a green light over the exact thing it claims to guard.
 */
describe('findUnsafeInterpolation — the #830 review findings', () => {
  // @codex. Prettier splits any call past the print width, so this is not an
  // edge case: it is what the formatter PRODUCES for a long string. Four real
  // sites were live in src/ while the first version printed OK.
  it('flags a call formatted across lines', () => {
    const source = [
      "  t('api-keys.source.oauth', 'OAuth: {clientId}').replace(",
      "    '{clientId}',",
      '    clientId,',
      '  ),',
    ].join('\n');
    expect(findUnsafeInterpolation(source)).toMatchObject([{ line: 1 }]);
  });

  it('flags a multi-line regex-form replacement too', () => {
    const source = ["x.replace(", "  /\\{shown\\}/g,", '  n,', ')'].join('\n');
    expect(findUnsafeInterpolation(source)).toHaveLength(1);
  });

  // @copilot. `before.includes('//')` treated the `//` in a URL as a comment
  // start, so any line carrying one was silently exempt.
  it('flags code on a line that also contains a URL', () => {
    const source = `const help = 'https://example.test/docs'; label.replace('{a}', a);`;
    expect(findUnsafeInterpolation(source)).toHaveLength(1);
  });

  it('reports the line the call STARTS on, not where the placeholder sits', () => {
    const source = ['const a = 1;', 'x.replace(', "  '{k}',", '  v,', ')'].join('\n');
    expect(findUnsafeInterpolation(source)).toMatchObject([{ line: 2 }]);
  });
});

describe('blankComments', () => {
  it('does not treat a URL inside a string as a comment', () => {
    expect(blankComments(`const u = 'https://x/y'; code();`)).toBe(`const u = 'https://x/y'; code();`);
  });

  it('blanks a line comment but keeps the line count', () => {
    const out = blankComments('a(); // gone\nb();');
    expect(out).toContain('a();');
    expect(out).not.toContain('gone');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('blanks a block comment across lines, preserving the newlines', () => {
    const out = blankComments('a();\n/* one\n   two */\nb();');
    expect(out).not.toContain('one');
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('b();');
  });

  it('does not end a string early on an escaped quote', () => {
    // `'\''` closes only at the LAST quote; a naive scanner would exit early
    // and then read the rest of the line as code.
    const src = String.raw`const s = 'it\'s // not a comment'; x();`;
    expect(blankComments(src)).toBe(src);
  });
});

/**
 * The gate against the real tree, in the ordinary suite — so a reintroduced
 * `.replace('{x}', v)` fails locally, before the push.
 */
describe('the repository as it stands', () => {
  it('has no unsafe placeholder interpolation', () => {
    const offenders = sourceFilesUnder('src').flatMap((file) =>
      findUnsafeInterpolation(readFileSync(file, 'utf8')).map((hit) => `${file}:${hit.line}`),
    );
    expect(offenders).toEqual([]);
  });
});
