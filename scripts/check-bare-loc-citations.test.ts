import { describe, expect, it } from 'vitest';
import { EXEMPT_FILES, findBareCitations, isCitationContext, scanAddedWithContext, scanDiff } from './check-bare-loc-citations.mjs';

/**
 * #781 — the gate's own test.
 *
 * A check that decides NOT to look at something is machinery with a hiding
 * place in it, so the interesting cases here are the ones it stays silent on:
 * each has to be silent for a stated reason, not by accident
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */
describe('findBareCitations', () => {
  it('flags a bare citation', () => {
    const found = findBareCitations('// see `review:no-silent-loader-catch` for why');
    expect(found.map((f) => f.text)).toEqual(['review:no-silent-loader-catch']);
  });

  it.each([
    ['review', '// (review:render-urn)'],
    ['findings', '// findings:table-chrome-conventions says'],
    ['conventions', '// per conventions:svelte-component-test-gap'],
    ['tasks', '// tasks:add-review-node governs the rest'],
  ])('flags a bare %s citation', (_w, line) => {
    expect(findBareCitations(line)).toHaveLength(1);
  });

  it('stays silent on a fully-qualified citation', () => {
    expect(
      findBareCitations(
        '// `hrn:node:hadronmemory.com:hadron-portal:review:render-urn` applies here',
      ),
    ).toEqual([]);
  });

  /**
   * The false positive that would otherwise have forced a path exclusion.
   * Fixture URNs in tests use the legacy `urn:` scheme; accepting it is a
   * property of the citation, so the check needs no `:!**\/*.test.ts` exclude
   * and therefore has no place for a real citation to hide.
   */
  it('stays silent on a legacy urn: fixture, WITHOUT needing a path exclusion', () => {
    expect(findBareCitations("value: 'urn:node:acme.com:kb:findings:flaky-ci'")).toEqual([]);
  });

  /**
   * A lookbehind for `:` would call this qualified — it is not. A memory slug
   * without the `hrn:node:` prefix is exactly the half-qualified form CLAUDE.md
   * warns about, because `mem` vs `node` is not recoverable from it.
   */
  it('flags a partially-qualified citation that a naive check would accept', () => {
    const found = findBareCitations('// See hadron-server:findings:asset-urn-shapes-are-variable.');
    expect(found.map((f) => f.text)).toEqual(['findings:asset-urn-shapes-are-variable']);
  });

  it('does not match a bare branch word with no loc', () => {
    expect(findBareCitations('// the review criteria live in Hadron')).toEqual([]);
    expect(findBareCitations('const findings = [];')).toEqual([]);
  });
});

describe('scanDiff — added lines only', () => {
  const diff = [
    'diff --git a/src/x.ts b/src/x.ts',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -1,0 +1,1 @@',
    '+// new: review:some-new-check',
    '-// removed: review:some-old-check',
    ' // context: review:some-context-check',
  ].join('\n');

  it('reports a citation on an added line', () => {
    expect(scanDiff(diff).map((f) => f.citation)).toEqual(['review:some-new-check']);
  });

  /**
   * The whole reason the gate can land now: ~79 pre-existing citations live in
   * `src/`, tracked by #781. Failing on those would block this until that
   * cleanup finished — and the cleanup is the slow half.
   */
  it('ignores removed and context lines, so the existing backlog does not block CI', () => {
    const citations = scanDiff(diff).map((f) => f.citation);
    expect(citations).not.toContain('review:some-old-check');
    expect(citations).not.toContain('review:some-context-check');
  });

  it('attributes a finding to its file', () => {
    expect(scanDiff(diff)[0].file).toBe('src/x.ts');
  });

  /**
   * `+++ b/…` starts with `+`. A scanner that treats every `+` line as content
   * reports its own header — and a header naming a path like
   * `src/lib/review:thing.ts` would be a phantom finding nobody can fix.
   */
  it('does not scan the +++ header as content', () => {
    const headerOnly = ['--- a/f.ts', '+++ b/src/review:not-a-citation.ts', '@@ -0,0 +1 @@'].join(
      '\n',
    );
    expect(scanDiff(headerOnly)).toEqual([]);
  });

  it('finds nothing in an empty diff', () => {
    expect(scanDiff('')).toEqual([]);
  });
});

describe('the exemption, stated and bounded', () => {
  /**
   * Pinning the exact set is the point: it failed when the #781 cleanup added
   * the third entry, which is the test doing its job. Widening this list should
   * always be a deliberate edit with a reason, never a silent drift.
   */
  it('exempts exactly three files, each for a stated reason', () => {
    expect([...EXEMPT_FILES].sort()).toEqual([
      // Contain examples of the thing being detected.
      'scripts/check-bare-loc-citations.mjs',
      'scripts/check-bare-loc-citations.test.ts',
      // User-facing docs whose subject IS loc/URN syntax — a `bare-loc-ok`
      // marker would leak a CI concern into prose a reader is shown.
      'src/lib/assets/hadron-instructions.md',
    ]);
  });

  it('does NOT exempt test files in general — the citation @codex found was in one', () => {
    const diff = [
      '+++ b/src/lib/test/mountComponent.client.test.ts',
      '+ * warns about `review:a-spare-test-must-reach-the-matcher`',
    ].join('\n');
    expect(scanDiff(diff).map((f) => f.citation)).toEqual([
      'review:a-spare-test-must-reach-the-matcher',
    ]);
  });

  it('skips the gate’s own example strings, which would otherwise fail it on itself', () => {
    const diff = [
      '+++ b/scripts/check-bare-loc-citations.mjs',
      "+const EXAMPLE = 'review:no-silent-loader-catch';",
    ].join('\n');
    expect(scanDiff(diff)).toEqual([]);
  });
});

describe('findings carry a location (@copilot on #809)', () => {
  it('reports the destination line number from the hunk header', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -0,0 +42,2 @@',
      '+// first added line',
      '+// see review:some-check',
    ].join('\n');
    const [f] = scanDiff(diff);
    expect(f.lineNumber).toBe(43);
    expect(f.column).toBeGreaterThan(0);
  });

  it('restarts the counter for each hunk and each file', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -0,0 +10,1 @@',
      '+// review:one',
      '@@ -0,0 +80,1 @@',
      '+// review:two',
      '+++ b/src/b.ts',
      '@@ -0,0 +5,1 @@',
      '+// review:three',
    ].join('\n');
    expect(scanDiff(diff).map((f) => `${f.file}:${f.lineNumber}`)).toEqual([
      'src/a.ts:10',
      'src/a.ts:80',
      'src/b.ts:5',
    ]);
  });

  /**
   * The scope fix: the policy is repo-wide, and the old pathspec (src/,
   * scripts/, CLAUDE.md) quietly exempted docs and workflows — the surfaces a
   * citation is MOST likely to be pasted onward from.
   */
  it('covers files outside src/ and scripts/', () => {
    const diff = [
      '+++ b/docs/how-to.md',
      '@@ -0,0 +1,1 @@',
      '+See review:render-urn for the rule.',
    ].join('\n');
    expect(scanDiff(diff).map((f) => f.file)).toEqual(['docs/how-to.md']);
  });
});

/**
 * The context classifier, added after the #781 cleanup measured the repo:
 * 124 of 244 raw matches were not citations. Two of them corrupted files when
 * a rewriter treated them as such, which is why each rule is pinned.
 */
describe('isCitationContext (#781)', () => {
  it('flags a citation in a comment', () => {
    expect(isCitationContext('src/a.ts', '// see review:render-urn', 11)).toBe(true);
  });

  it('flags one in markdown prose', () => {
    expect(isCitationContext('docs/a.md', 'See review:render-urn.', 5)).toBe(true);
  });

  /** Rule 1 — a loc in executable code is a value under test, not a citation. */
  it('ignores a fixture loc in code', () => {
    expect(isCitationContext('src/x.test.ts', "      loc: 'findings:x',", 13)).toBe(false);
    expect(isCitationContext('src/x.ts', "const r = 'review:render-urn';", 12)).toBe(false);
  });

  /**
   * @codex on #811: a memory-prefixed shorthand IS a bare citation and must be
   * REPORTED. An earlier draft exempted it because a rewriter cannot fix it in
   * place (the matched suffix alone yields `hadron-server:hrn:node:…`) — but
   * that is a fact about the fixer, and letting it reach the detector meant
   * three real citations in this repo went unreported.
   */
  it('FLAGS a memory-prefixed shorthand, even though a rewriter cannot fix it in place', () => {
    const line = '// See hadron-server:findings:asset-urn-shapes-are-variable.';
    expect(isCitationContext('src/a.ts', line, line.indexOf('findings:') + 1)).toBe(true);
  });

  /**
   * @codex on #811: `.svelte` files write `<!-- …` and continue on the next
   * line, so a continuation carries no opening delimiter. A closing `-->` marks
   * it as inside a comment.
   */
  it('flags a citation on a multiline-comment continuation line', () => {
    const line = '     per review:render-urn the URN renders alongside -->';
    expect(isCitationContext('src/A.svelte', line, line.indexOf('review:') + 1)).toBe(true);
  });

  /**
   * Rule 3 — a doc listing URN FORMS writes them as `- bare loc: 'review:x'`.
   * Qualifying one makes the label contradict its own example; this corrupted
   * `clean-loc-input.ts` before the rule existed.
   */
  it("ignores a single-quoted sample value in a form-documentation comment", () => {
    const line = " *   - bare loc:  'review:render-urn'";
    expect(isCitationContext('src/lib/urn/clean-loc-input.ts', line, line.indexOf('review:') + 1)).toBe(false);
  });

  it('still flags a backticked citation, which is how this repo writes them', () => {
    const line = '// per `review:render-urn` the URN renders alongside';
    expect(isCitationContext('src/a.ts', line, line.indexOf('review:') + 1)).toBe(true);
  });
});

describe('scanDiff applies the classifier', () => {
  it('ignores an added FIXTURE line but flags an added COMMENT', () => {
    const diff = [
      '+++ b/src/lib/urn/thing.test.ts',
      '@@ -0,0 +1,2 @@',
      "+    expect(parse('findings:x')).toBe(true);",
      '+    // per review:render-urn this is fine',
    ].join('\n');
    expect(scanDiff(diff).map((f) => f.citation)).toEqual(['review:render-urn']);
  });
});

/**
 * @codex and @copilot, independently, on #811: `prevAdded` let a `bare-loc-ok`
 * marker leak past the end of its hunk or file and suppress an unrelated
 * finding. A marker that silences code it was never written for is the worst
 * kind of exemption — invisible at both ends.
 */
describe('the bare-loc-ok marker does not leak across boundaries', () => {
  it('suppresses the line directly below it', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -0,0 +1,2 @@',
      '+// bare-loc-ok — a shape, not a citation.',
      '+//   review:some-shape',
    ].join('\n');
    expect(scanDiff(diff)).toEqual([]);
  });

  it('does NOT carry into the next hunk', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -0,0 +1,1 @@',
      '+// bare-loc-ok — a shape, not a citation.',
      '@@ -0,0 +90,1 @@',
      '+// per review:some-real-check',
    ].join('\n');
    expect(scanDiff(diff).map((f) => f.citation)).toEqual(['review:some-real-check']);
  });

  it('does NOT carry into the next file', () => {
    const diff = [
      '+++ b/src/a.ts',
      '@@ -0,0 +1,1 @@',
      '+// bare-loc-ok — a shape, not a citation.',
      '+++ b/src/b.ts',
      '@@ -0,0 +1,1 @@',
      '+// per review:some-real-check',
    ].join('\n');
    expect(scanDiff(diff).map((f) => f.file)).toEqual(['src/b.ts']);
  });
});

/**
 * @codex on #811, second round: the diff-only scanner cannot see block-comment
 * state, so the MIDDLE line of a three-line `<!-- … -->` reads as code. Reading
 * the file closes it properly rather than widening a line-local heuristic —
 * "added lines only" is preserved by FILTERING afterwards, not by looking at
 * less.
 */
describe('scanAddedWithContext (#811 review 2)', () => {
  const diff = ['+++ b/src/A.svelte', '@@ -0,0 +3,1 @@', '+     per review:render-urn it renders'].join('\n');
  const file = [
    '<div>',
    '  <!--',
    '     Some explanation that wraps.',
    '     per review:render-urn it renders',
    '  -->',
  ].join('\n');

  it('flags a citation on the MIDDLE line of a block comment, which the diff alone cannot see', () => {
    // The added line has no opener and no closer of its own.
    const middle = '     per review:render-urn it renders';
    expect(findBareCitations(middle, 'src/A.svelte')).toEqual([]);           // line-local: invisible
    const found = scanAddedWithContext(diff.replace('+3,1', '+4,1'), () => file);
    expect(found.map((f) => f.citation)).toEqual(['review:render-urn']);     // with context: caught
  });

  it('still ignores a citation-shaped value in CODE, with full context available', () => {
    const codeFile = ["const x = 'findings:x';", "const y = 2;"].join('\n');
    const d = ['+++ b/src/b.ts', '@@ -0,0 +1,1 @@', "+const x = 'findings:x';"].join('\n');
    expect(scanAddedWithContext(d, () => codeFile)).toEqual([]);
  });

  it('reports only ADDED lines, not every citation in the file', () => {
    const f2 = ['// per review:one', '// per review:two'].join('\n');
    const d = ['+++ b/src/c.ts', '@@ -0,0 +2,1 @@', '+// per review:two'].join('\n');
    expect(scanAddedWithContext(d, () => f2).map((x) => x.citation)).toEqual(['review:two']);
  });

  it('skips a file it cannot read (deleted or binary)', () => {
    const d = ['+++ b/src/gone.ts', '@@ -0,0 +1,1 @@', '+// per review:x'].join('\n');
    expect(scanAddedWithContext(d, () => null)).toEqual([]);
  });
});

/**
 * #816 — SPEC citations (`cor:<module>:<feature>:<rule>`).
 *
 * Structurally invisible to the branch-word pattern: a spec loc starts with
 * `cor` rather than a branch word, and its tail is NUMERIC. So the rule was
 * enforced for node locs and unenforced for the citations that carry platform
 * law — #814 added seven bare `cor:dmo:060:12` refs and CI passed every time.
 */
describe('spec citations (#816)', () => {
  it('flags a bare spec citation', () => {
    expect(findBareCitations('// see cor:dmo:060:12 for the tombstone rule').map((f) => f.text))
      .toEqual(['cor:dmo:060:12']);
  });

  it.each([
    ['a feature-level citation', 'cor:agt:020'],
    ['a rule', 'cor:api:090:03'],
    ['a flow', 'cor:acl:080:02'],
  ])('flags %s', (_what, citation) => {
    expect(findBareCitations(`// per ${citation} this holds`)).toHaveLength(1);
  });

  it('stays silent on a fully-qualified spec citation', () => {
    expect(findBareCitations('// per `hrn:node:hadronmemory.com:specs:cor:dmo:060:12` this holds')).toEqual([]);
  });

  // The shapes that merely look like one. A spec loc is three letters then
  // three digits; anything else is prose that happens to contain colons.
  it.each([
    ['a version string', '// bumped to cor:v2:beta today'],
    ['a two-letter module', '// cor:ab:010:01 is not the register shape'],
    ['a two-digit feature', '// cor:dmo:06:12 is malformed'],
  ])('stays silent on %s', (_what, line) => {
    expect(findBareCitations(line)).toEqual([]);
  });

  // #831 review, @codex: link text is NOT exempt just because the href is
  // qualified. The repo requires the fully-qualified form in docs, and a label
  // copied out of rendered markdown loses its memory exactly as a bare loc in
  // prose does. An earlier version of this gate exempted it to avoid the
  // doubled string; the doubling is cosmetic and the rule is not, so the two
  // comments that hit it dropped the link form instead.
  it('flags bare link text even when the href is fully qualified', () => {
    const line = ' * Per [`cor:urn:010:01`](hrn:node:hadronmemory.com:specs:cor:urn:010:01), a v2 URN';
    expect(findBareCitations(line, 'src/x.ts').map((f) => f.text)).toEqual(['cor:urn:010:01']);
  });

  it('flags bare link text whose href is a portal URL', () => {
    const line = ' * Per [`cor:urn:010:01`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:specs:cor:urn:010:01)';
    expect(findBareCitations(line, 'src/x.ts').map((f) => f.text)).toEqual(['cor:urn:010:01']);
  });

  // #831 review, @copilot. `cor:dmo:060:12abc` is an identifier, not a
  // citation — and a trailing `\b`, the obvious fix, would report the PREFIX
  // `cor:dmo:060` instead, trading a wrong flag for a wrong span.
  it.each([
    ['a trailing word character', '// cor:dmo:060:12abc'],
    ['a three-digit tail', '// cor:dmo:060:123'],
    ['a trailing hyphenated word', '// cor:dmo:060:12-beta'],
  ])('stays silent on %s, and does not report a prefix either', (_what, line) => {
    expect(findBareCitations(line)).toEqual([]);
  });

  it('still flags a citation followed by a sentence colon', () => {
    // Punctuation must not cost a real citation.
    expect(findBareCitations('// per cor:api:090: the rule holds').map((f) => f.text)).toEqual(['cor:api:090']);
  });

  it('flags a full four-level citation', () => {
    expect(findBareCitations('// cor:acl:080:02:03 applies').map((f) => f.text)).toEqual(['cor:acl:080:02:03']);
  });

  it('honours the bare-loc-ok escape hatch, same as a branch-word citation', () => {
    expect(findBareCitations('// cor:dmo:060:12 as a shape — bare-loc-ok', 'src/x.ts')).toEqual([]);
  });
});
