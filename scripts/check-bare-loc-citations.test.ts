import { describe, expect, it } from 'vitest';
import { EXEMPT_FILES, findBareCitations, scanDiff } from './check-bare-loc-citations.mjs';

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
  it('exempts exactly two files — this check and its own test', () => {
    expect([...EXEMPT_FILES].sort()).toEqual([
      'scripts/check-bare-loc-citations.mjs',
      'scripts/check-bare-loc-citations.test.ts',
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
