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

  // Gaia P2-1 (portal#1751 BLIND): a focus-scoped suppression accepted WITHOUT the
  // focus-visible outline-STYLE restatement. Width/colour utilities draw with
  // --tw-outline-style, which the suppression left at none — the ring never paints.
  // Gaia P3-2 (BLIND delta): bare `focus-visible:outline` draws WITH the variable too
  // (emits outline-style: var(--tw-outline-style); outline-width: 1px), so it is a
  // draw-wanting token the gate must see, not just `outline-<width>`.
  it.each([
    ['width-only restatement (Gaia P2-1)', `<div class="focus:outline-none focus-visible:outline-2">`],
    ['inverse ordering', `<div class="focus-visible:outline-2 focus:outline-none">`],
    ['width + colour, still no style', `<div class="focus:outline-none focus-visible:outline-2 focus-visible:outline-indigo-500">`],
    ['bare focus-visible:outline, still no style (Gaia P3-2)', `<div class="focus:outline-none focus-visible:outline">`],
    // The chain ends in `focus` (it IS focus-scoped) under an extra variant, with no
    // restatement at all — the label says what the shape is, not "non-focus".
    ['extra-variant suppression, width-only restatement', `<div class="dark:focus:outline-none focus-visible:outline-2">`],
  ])('flags the scoped-but-unrestated suppression: %s', (_what, line) => {
    const findings = findOutlineNoneTrap(line);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('noRestatement');
  });

  // `outline-hidden` sets --tw-outline-style:none too (verified against the installed
  // tailwindcss 4; its forced-colors fallback outline does not save the normal scheme) —
  // Gaia's open question, confirmed as the same trap.
  it.each([
    ['bare outline-hidden', `<div class="outline-hidden focus-visible:outline-2">`],
    ['scoped outline-hidden, no restatement', `<div class="focus:outline-hidden focus-visible:outline-2">`],
  ])('flags outline-hidden beside a draw-wanting token: %s', (_what, line) => {
    expect(findOutlineNoneTrap(line)).toHaveLength(1);
  });

  // The restatement must be focus-visible-scoped and conditioned exactly like the
  // suppression it answers.
  it.each([
    // Bare `outline-solid` sets the variable globally at (0,1,0), but the focus-scoped
    // suppression out-ranks it under :focus at (0,2,0) — specificity, not cascade
    // order (Basil P3, portal#1751 LOCAL delta: the suite did not pin this shape).
    ['bare outline-solid is not a restatement', `<div class="focus:outline-none outline-solid focus-visible:outline-2">`],
    // A restatement variant the suppression does not share exists only under that
    // condition: this repo's dark: is class-scoped (:where(.dark, .dark *) via
    // @custom-variant in src/app.css) and md: is a width media query — verified in the
    // compiled css — so without .dark / below the breakpoint the suppression keeps
    // --tw-outline-style:none and nothing paints (Gaia P3-1, confirmed; her delta
    // marked it P2 if the compiled CSS confirmed — it does).
    ['dark-conditioned restatement', `<div class="focus:outline-none dark:focus-visible:outline-solid focus-visible:outline-2">`],
    ['breakpoint-conditioned restatement', `<div class="focus:outline-none md:focus-visible:outline-solid focus-visible:outline-2">`],
    // The inverse shape: an extras-carrying suppression beside a PLAIN restatement.
    // Both match under the condition at equal specificity, and the conditioned
    // suppression sorts after the plain restatement in the compiled css
    // (.dark:focus:outline-none at a higher index than .focus-visible:outline-solid),
    // so dark mode keeps style:none — the extras must match, not just be present
    // (Gaia P3-1 stacked suppression, confirmed; P2-grade per her rule).
    ['stacked suppression, plain restatement', `<div class="dark:focus:outline-none focus-visible:outline-solid">`],
    ['stacked suppression, extras on the wrong token', `<div class="dark:focus:outline-none md:focus-visible:outline-solid focus-visible:outline-2">`],
  ])('flags the conditioned or unscoped restatement: %s', (_what, line) => {
    const findings = findOutlineNoneTrap(line);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('noRestatement');
  });

  // A suppression scoped to focus-visible itself can never be restated safely: any
  // style utility beside it shares its variant, equal specificity leaves the winner
  // to tailwind's utility sort order — and that order is not a contract. In the
  // compiled css outline-none (idx 104542) sorts AFTER dashed (104152)/dotted
  // (104282)/double (104412) but BEFORE solid (104666), so the dashed pair never
  // paints while the solid pair does: the outcome flips by which style utility is
  // picked, which is exactly why the gate refuses the shape outright (Gaia P3-1
  // same-variant pair; the solid flip confirmed on her 5b7e1afe delta).
  it.each([
    ['width-only beside a focus-visible suppression', `<div class="focus-visible:outline-none focus-visible:outline-2">`],
    ['style restatement under the same variant', `<div class="focus-visible:outline-none focus-visible:outline-dashed">`],
    // The solid pair would PAINT (solid sorts after none) and is refused anyway —
    // the bright line does not depend on the sort outcome.
    ['solid under the same variant paints and is refused anyway', `<div class="focus-visible:outline-none focus-visible:outline-solid">`],
    ['same variant, matching extras on both', `<div class="dark:focus-visible:outline-none dark:focus-visible:outline-solid">`],
  ])('flags the same-variant suppression: %s', (_what, line) => {
    const findings = findOutlineNoneTrap(line);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('sameVariant');
  });

  it('reports every offending token, not just the first', () => {
    const line = `<div class="outline-none md:outline-none focus-visible:outline-2">`;
    expect(findOutlineNoneTrap(line)).toHaveLength(2);
  });

  // The fixed spellings on main, both orderings.
  it.each([
    ['the fix', `class="focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"`],
    ['the inverse ordering', `class="focus-visible:outline-2 focus-visible:outline-indigo-500 focus:outline-none focus-visible:outline-solid"`],
    // The extras-matched pair Gaia's P3-1 fix endorses: same extra variants on both
    // tokens, so the restatement exists exactly where the suppression does and sorts
    // after it inside the same condition (verified in the compiled css:
    // .dark:focus:outline-none before .dark:focus-visible:outline-solid).
    ['a stacked focus variant, extras matched', `class="dark:focus:outline-none dark:focus-visible:outline-solid focus-visible:outline-2"`],
    ['a non-solid painting style', `class="focus:outline-none focus-visible:outline-dashed focus-visible:outline-2"`],
    ['outline-hidden with the style restated', `class="focus:outline-hidden focus-visible:outline-solid focus-visible:outline-2"`],
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

  // Pins WANTS_RING's (?!none|hidden) lookahead: focus-visible:outline-none is not a
  // draw-wanting token, so even a BARE outline-none beside it is not the defect pair
  // (nothing is being suppressed-then-drawn). Dropped the lookahead and this line would
  // flag (Basil P3-3).
  it('stays silent on a bare outline-none beside focus-visible:outline-none (the lookahead: no draw-wanting token)', () => {
    expect(findOutlineNoneTrap(`<input class="outline-none focus-visible:outline-none">`)).toEqual([]);
  });

  // Gaia P2 (portal#1751 BLIND delta at 8676d593): outline-hidden must be excluded from
  // WANTS_RING exactly like outline-none — `focus-visible:outline-hidden
  // focus-visible:ring-2` is a valid ring-based pattern (outline hidden on purpose with
  // its forced-colors fallback, the ring drawn by ring-*), not a suppressed-then-drawn
  // pair. The old (?!none) lookahead made outline-hidden itself count as draw-wanting
  // and flagged this as noRestatement, steering the author to add outline-solid beside
  // a working ring.
  it.each([
    ['outline-hidden beside a box-shadow ring', `<input class="focus-visible:outline-hidden focus-visible:ring-2">`],
    ['outline-hidden beside focus-visible:outline-hidden', `<input class="outline-hidden focus-visible:outline-hidden">`],
    ['bare focus-visible:outline with no suppression on the element', `<input class="focus-visible:outline">`],
  ])('stays silent on %s (no suppression-then-draw pair)', (_what, line) => {
    expect(findOutlineNoneTrap(line)).toEqual([]);
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

  it('the Gaia P2-1 mutant: stripping only the style restatement is found', () => {
    const files = [join(root, 'src/lib/components/tickers/ApplyAgentTickers.svelte')];
    const real = readFileSyncOrNull(files[0]);
    expect(real).toBeTruthy();
    // Leave the scoped suppression and every width/colour utility; remove ONLY the
    // focus-visible:outline-solid restatement — the exact spelling the first version of
    // this guard wrongly accepted (Gaia P2-1, portal#1751 BLIND).
    const mutant = real!.replace(' focus-visible:outline-solid', '');
    expect(mutant).not.toBe(real); // the seed actually took
    const findings = scanFiles(files, () => mutant);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('noRestatement');
  });
});

function readFileSyncOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
