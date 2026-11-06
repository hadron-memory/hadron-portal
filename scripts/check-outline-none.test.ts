import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findOutlineNoneTrap, scanFiles, sourceFilesUnder } from './check-outline-none.mjs';

/**
 * #1745 — the gate's own test. Both directions are pinned: the broken spelling IS
 * flagged (the two shipped shapes, #1619 and #1675, are the fixtures), the fixed
 * spellings are not, and a live scan of the repo's own `src/` stays empty — so a
 * regression into `src/` reddens this test in the same run that reddens the gate,
 * and a gate that went blind fails the mutant arms here
 * (hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven).
 *
 * The silences matter as much as the flags: every one is a place the broken spelling
 * can hide, so each is stated and pinned to the shape that actually appears in the
 * repo.
 */
describe('findOutlineNoneTrap', () => {
  // The two shipped defects, verbatim shapes.
  it('flags the #1619 shape: a suppression plus a ring on one element', () => {
    const line = `<h2 id="x" tabindex="-1" class="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Title</h2>`;
    expect(findOutlineNoneTrap(line)).toHaveLength(1);
  });

  it('flags the #1675 shape inside a longer utility list', () => {
    const line = `<div class="space-y-2 outline-none focus-visible:outline-2 focus-visible:outline-indigo-500" aria-live="polite">`;
    expect(findOutlineNoneTrap(line)).toHaveLength(1);
  });

  it('flags a non-focus variant scoping the suppression (md:outline-none)', () => {
    const line = `<button class="md:outline-none focus-visible:outline-2">go</button>`;
    expect(findOutlineNoneTrap(line)).toHaveLength(1);
  });

  it('reports every offending token, not just the first', () => {
    const line = `<div class="outline-none md:outline-none focus-visible:outline-2">`;
    expect(findOutlineNoneTrap(line)).toHaveLength(2);
  });

  // The fixed spellings on main, both orderings.
  it.each([
    ['the fix', `class="focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"`],
    ['the inverse ordering', `class="focus-visible:outline-2 focus-visible:outline-indigo-500 focus:outline-none focus-visible:outline-solid"`],
    ['a stacked focus variant', `class="dark:focus:outline-none focus-visible:outline-solid"`],
  ])('accepts %s', (_what, line) => {
    expect(findOutlineNoneTrap(`<p ${line}>x</p>`)).toEqual([]);
  });

  // The silences, each stated.
  it('stays silent on a bare outline-none with no focus-visible:outline-* on the element', () => {
    // Nothing is being suppressed-then-drawn; the pinned rule is the pair, not the token.
    expect(findOutlineNoneTrap(`<input class="outline-none focus:ring-2 focus:ring-indigo-500">`)).toEqual([]);
  });

  it('stays silent on focus-visible:outline-none alone (scoped, and no draw-wanting token)', () => {
    expect(findOutlineNoneTrap(`<input class="focus-visible:outline-none">`)).toEqual([]);
  });

  it.each([
    ['a dynamic class expression', `<div class={cls(x)} data-note="focus-visible:outline-2 outline-none">`],
    ['a Svelte class directive', `<div class:outline-none={x} class="focus-visible:outline-2">`],
    ['a multi-line class attribute (line-local read)', `<div\n  class="outline-none\n       focus-visible:outline-2">`],
    ['a bracket variant chain', `<div class="[&>*]:outline-none focus-visible:outline-2">`],
  ])('stays silent on %s — an enumerated silence', (_what, line) => {
    // Multi-line input exercises the line-local read one line at a time.
    for (const single of line.split('\n')) {
      expect(findOutlineNoneTrap(single)).toEqual([]);
    }
  });
});

describe('scanFiles over the real repo', () => {
  const root = resolve(join(import.meta.dirname, '..'));

  it('main as-is passes: no outline-none trap anywhere under src/', () => {
    const files = sourceFilesUnder(join(root, 'src'));
    expect(files.length).toBeGreaterThan(100); // the scan actually covered the repo
    expect(scanFiles(files, (f) => readFileSyncOrNull(f))).toEqual([]);
  });

  it('the mutant direction: reintroducing the broken spelling into src/ is found', () => {
    const files = [join(root, 'src/lib/components/tickers/ApplyAgentTickers.svelte')];
    const real = readFileSyncOrNull(files[0]);
    expect(real).toBeTruthy();
    // Seed the #1675 defect back into the file the fix landed on: the guard must find it.
    const mutant = real!.replace(
      'focus:outline-none focus-visible:outline-solid',
      'outline-none',
    );
    expect(mutant).not.toBe(real); // the seed actually took
    const findings = scanFiles(files, () => mutant);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('ApplyAgentTickers.svelte');
  });
});

function readFileSyncOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
