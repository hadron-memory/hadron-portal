/**
 * #858 — the tab-strip gate's own suite.
 *
 * Every case runs the REAL `offences()` over source, because the stop-gap this
 * gate replaces failed precisely by not doing that: it matched tokens against
 * whole files, so the comments explaining each fix satisfied the assertions and
 * deleting a real class left it green.
 *
 * `hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`
 * — the FLAGS cases below are the point of this file. A gate exercised only
 * against a clean tree is decoration, and #849 shipped one with three holes of
 * the class it was written for.
 */
import { describe, expect, it } from 'vitest';
import { offences } from './check-tab-strips.mjs';

/** A strip with everything right — the shape the repo now has everywhere. */
const FIXED = `
<div class="mb-3 flex gap-0 overflow-x-auto border-b border-zinc-200">
  <button class="shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5">One</button>
  <button class="shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5">Two</button>
</div>`;

const kinds = (src: string) => offences(src).map((o) => o.kind);

describe('the gate passes what it should', () => {
  it('a strip that scrolls with non-shrinking tabs', () => {
    expect(offences(FIXED)).toEqual([]);
  });

  it('a strip whose SCROLLER is an inner element, not the rail', () => {
    // `/app/assets` in the wild: the rail is a justify-between row and the
    // scrolling element is the inner <nav> holding the tabs. A check that only
    // looked at the rail would report a false positive here.
    expect(
      offences(`
      <div class="flex items-end justify-between border-b border-zinc-200">
        <nav class="flex min-w-0 gap-0 overflow-x-auto">
          <a class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2">One</a>
          <a class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2">Two</a>
        </nav>
        <span class="shrink-0 text-xs">3 files</span>
      </div>`),
    ).toEqual([]);
  });

  it('tokens supplied through an interpolation still count', () => {
    // Svelte classes are routinely part static, part expression. Reading only
    // the static chunks would demand a class the element already has.
    expect(
      offences(`
      <div class="flex gap-0 overflow-x-auto border-b">
        <button class="border-b-2 {compact ? 'shrink-0 whitespace-nowrap' : 'shrink-0 whitespace-nowrap'}">One</button>
        <button class="border-b-2 {compact ? 'shrink-0 whitespace-nowrap' : 'shrink-0 whitespace-nowrap'}">Two</button>
      </div>`),
    ).toEqual([]);
  });

  it('a SEGMENTED CONTROL is not a tab strip', () => {
    // Two buttons, no bottom rail — the Rendered/Source toggle shape. Demanding
    // `overflow-x-auto` here would be noise, and noise is how a gate grows an
    // exclusion list
    // (hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven).
    expect(
      offences(`
      <div role="group" class="flex shrink-0 overflow-hidden rounded-md border">
        <button class="px-2 py-1 text-xs">Rendered</button>
        <button class="px-2 py-1 text-xs">Source</button>
      </div>`),
    ).toEqual([]);
  });

  it('a rail with only ONE tab is not a strip', () => {
    expect(
      offences(`
      <div class="flex gap-0 border-b">
        <button class="border-b-2 px-3">Only</button>
      </div>`),
    ).toEqual([]);
  });
});

describe('the gate FLAGS what it should — the half that makes it real', () => {
  it('a rail with no overflow-x-auto anywhere above its tabs', () => {
    expect(kinds(FIXED.replace(' overflow-x-auto', ''))).toContain('strip-does-not-scroll');
  });

  it('a tab that can shrink', () => {
    expect(kinds(FIXED.replace(/shrink-0 /g, ''))).toContain('tab-can-shrink');
  });

  it('a tab that can wrap — INDEPENDENTLY of shrink-0', () => {
    // Each required token needs a fixture omitting only IT. A case missing both
    // stays green if the gate quietly stops checking one of them, which is half
    // a requirement proven (@copilot on #859).
    const wrapOnly = FIXED.replace(/whitespace-nowrap /g, '');
    expect(kinds(wrapOnly)).toContain('tab-can-wrap');
    expect(kinds(wrapOnly)).not.toContain('tab-can-shrink');
  });

  it('is NOT fooled by a comment naming every class — the stop-gap’s defect', () => {
    // The exact shape that made #859's source-grep worthless: markup stripped
    // of the classes, beside a comment mentioning all of them. A parser reads
    // the tree, so a comment is not an attribute.
    const commented = `
      <!-- #858 — overflow-x-auto, with shrink-0 whitespace-nowrap on each tab -->
      <div class="flex gap-0 border-b border-zinc-200">
        <button class="border-b-2 px-3">One</button>
        <button class="border-b-2 px-3">Two</button>
      </div>`;
    expect(kinds(commented)).toContain('strip-does-not-scroll');
    expect(kinds(commented)).toContain('tab-can-shrink');
  });

  it('is not fooled by the token sitting on an UNRELATED element', () => {
    // The question a regex cannot answer, and the reason this gate parses:
    // `overflow-x-auto` is present in the file, on a row that is not the strip.
    expect(
      kinds(`
      <div class="flex overflow-x-auto">a scrolling row that is not the strip</div>
      <div class="flex gap-0 border-b border-zinc-200">
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">One</button>
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">Two</button>
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('survives a class attribute wrapped across lines', () => {
    // prettier wraps at 100 columns, and a line-based scan walks straight
    // through the wrapped form — the bare-loc gate's sibling problem, named on
    // #849. The parser takes the attribute as a unit.
    expect(
      kinds(`
      <div
        class="mb-3 flex gap-0 border-b border-zinc-200 dark:border-zinc-800 lg:mb-4 xl:mb-5"
      >
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">One</button>
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">Two</button>
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('reports an unparseable file rather than passing it', () => {
    // A gate that silently skips what it cannot read can be switched off by a
    // toolchain change nobody notices.
    expect(kinds('<div class="flex border-b"><button class="border-b-2">')).toContain('unparseable');
  });
});
