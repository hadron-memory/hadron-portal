import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findUnsafeInterpolation, inComment, sourceFilesUnder } from './check-unsafe-interpolation.mjs';

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
    ['a chained second link', `x.replace('{a}', a).replace('{b}', b)`],
    ['spacing inside the call', `x.replace( '{a}' , a)`],
  ])('flags %s', (_what, line) => {
    expect(findUnsafeInterpolation(line)).toHaveLength(1);
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
    ['a block-comment continuation', ` * holder would want \`t(...).replace('{who}', handle)\`, and that expands $&`],
    ['a trailing comment', `const x = 1; // was .replace('{a}', a)`],
  ])('stays silent on %s', (_what, line) => {
    expect(findUnsafeInterpolation(line)).toEqual([]);
  });

  it('still flags code that merely sits near a comment', () => {
    expect(findUnsafeInterpolation(`x.replace('{a}', a); // fix me`)).toHaveLength(1);
  });
});

describe('inComment', () => {
  it('is false for code with no comment before the match', () => {
    expect(inComment(`x.replace('{a}', a)`, 1)).toBe(false);
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
