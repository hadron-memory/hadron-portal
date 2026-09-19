/**
 * #858 — every horizontal tab strip in the narrow content column scrolls.
 *
 * A strip of tabs in the portal's ~308px column overflows the page at phone
 * widths unless it carries `overflow-x-auto`, and unless each tab carries
 * `shrink-0 whitespace-nowrap` so flex lets the strip scroll rather than
 * compressing the labels into unreadable columns (PR #746, item 2).
 *
 * ## This file's first draft was decoration, and the way it failed is the point
 *
 * It asserted `expect(source(file)).toMatch(/overflow-x-auto/)` — a substring
 * search over the whole file. Every one of those passes on a file whose markup
 * has been stripped of the class, because the COMMENT explaining the fix
 * contains the same token. Deleting `overflow-x-auto` from the memories strip
 * left all ten assertions green (@codex and @copilot, independently, on #859).
 *
 * Worse, the mutation check that was supposed to catch this DID run — against
 * `/app/account`, the one file whose comment happens not to name the class. I
 * mutated the case I had thought of rather than the one that mattered, which is
 * the same failure as #852 one PR earlier.
 *
 * So the predicate now reads the MARKUP: comments stripped, class attributes
 * extracted, and the required tokens asserted on the specific elements that
 * must carry them. `guardCanFail` below runs that real predicate against
 * synthetic unfixed source, rather than comparing a hand-written string to
 * itself as the first draft's "proven to fail" case did.
 *
 * Deliberately NOT keyed on `role="tablist"`: the node detail page's strip
 * (#854) is plain `<button>`s with no ARIA roles, so an ARIA-keyed predicate
 * misses the page that is actually broken. The strip's SHAPE is the signal, and
 * this is the same predicate #858 proposes for the CI gate — that gate should
 * subsume this file rather than disagree with it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STRIPS: Array<{ file: string; label: string; measured: string }> = [
  {
    file: 'src/routes/app/account/+layout.svelte',
    label: '/app/account',
    measured: '335px in a 308px column — 10px of document overflow before the fix',
  },
  {
    file: 'src/routes/app/memories/+page.svelte',
    label: '/app/memories',
    measured: '308px in a 308px column — exactly at the edge',
  },
  {
    file: 'src/routes/app/orgs/[id]/agents/+page.svelte',
    label: '/app/orgs/[id]/agents',
    measured: '308px in a 308px column — exactly at the edge',
  },
  {
    file: 'src/routes/app/assets/+page.svelte',
    label: '/app/assets',
    measured: '274px in a 308px column — had room, guarded anyway',
  },
];

/**
 * Source with every comment removed — the whole reason this rewrite exists.
 *
 * Markup comments are where the explanatory notes live; the script-comment
 * passes are belt-and-braces, since a `// … overflow-x-auto …` note in a
 * `<script>` block would fool the predicate exactly the same way.
 */
function markup(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every `class` attribute's raw text.
 *
 * Svelte class values interpolate (`class="a {cond ? 'x' : 'y'}"`), so the
 * attribute is taken verbatim rather than parsed — the assertions only ask
 * whether a token is present, and a token inside an interpolation is still
 * applied.
 */
function classAttrs(src: string): string[] {
  return [...src.matchAll(/class=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => m[1] ?? m[2] ?? '');
}

/** The strip: a flex row of tabs. Matches the shape, not an ARIA role. */
function stripClasses(src: string): string[] {
  return classAttrs(src).filter((c) => /\bflex\b/.test(c) && /\bgap-0\b/.test(c));
}

/** The tabs themselves — `border-b-2` is the underline every tab carries. */
function tabClasses(src: string): string[] {
  return classAttrs(src).filter((c) => /\bborder-b-2\b/.test(c));
}

describe('#858 — tab strips scroll instead of overflowing', () => {
  it.each(STRIPS)('$label: the strip itself scrolls ($measured)', ({ file }) => {
    const strips = stripClasses(markup(file));
    // A file with no strip at all would otherwise pass `every` vacuously — the
    // shape this predicate has to be pinned against, since a refactor that
    // renames the container is indistinguishable from one that removes it.
    expect(strips.length).toBeGreaterThan(0);
    for (const c of strips) expect(c).toMatch(/\boverflow-x-auto\b/);
  });

  it.each(STRIPS)('$label: every tab refuses to shrink or wrap', ({ file }) => {
    const tabs = tabClasses(markup(file));
    expect(tabs.length).toBeGreaterThan(0);
    for (const c of tabs) {
      // Both halves. Without `shrink-0` flex compresses the labels instead of
      // scrolling; without `whitespace-nowrap` a long label wraps and the strip
      // grows vertically rather than horizontally.
      expect(c).toMatch(/\bshrink-0\b/);
      expect(c).toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it('/app/assets also lets its nav SHRINK, which is the half that bites there', () => {
    // That nav is a flex item of a `justify-between` row, and a flex item's
    // default `min-width: auto` refuses to shrink below its content — so
    // `overflow-x-auto` alone never engages and the row pushes the file count
    // off-screen instead. Same shape as the AI-config select that was the last
    // thing still scrolling the App page in #746.
    const strips = stripClasses(markup('src/routes/app/assets/+page.svelte'));
    expect(strips.some((c) => /\bmin-w-0\b/.test(c))).toBe(true);
  });

  describe('the predicate can actually fail', () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail.
    // Run the REAL functions over synthetic unfixed source. The first draft
    // asserted that a hand-written string did not contain a token it had never
    // been given — which proves nothing about the predicate.
    const UNFIXED_STRIP = `<div class="flex gap-0 border-b border-zinc-200">
      <button class="border-b-2 px-4 py-2 text-sm">One</button>
    </div>`;

    it('flags a strip with no overflow-x-auto', () => {
      const strips = stripClasses(UNFIXED_STRIP);
      expect(strips.length).toBeGreaterThan(0);
      expect(strips.every((c) => /\boverflow-x-auto\b/.test(c))).toBe(false);
    });

    it('flags tabs with no shrink-0 / whitespace-nowrap', () => {
      const tabs = tabClasses(UNFIXED_STRIP);
      expect(tabs.length).toBeGreaterThan(0);
      expect(tabs.every((c) => /\bshrink-0\b/.test(c))).toBe(false);
    });

    it('is NOT fooled by a comment naming the classes — the original defect', () => {
      // The exact shape that made the first draft worthless: markup stripped of
      // the classes, beside a comment that mentions all of them.
      const commentedButUnfixed = `
        <!-- #858 — overflow-x-auto, with shrink-0 whitespace-nowrap on each tab -->
        ${UNFIXED_STRIP}`;
      const src = markup0(commentedButUnfixed);
      expect(stripClasses(src).every((c) => /\boverflow-x-auto\b/.test(c))).toBe(false);
      expect(tabClasses(src).every((c) => /\bshrink-0\b/.test(c))).toBe(false);
    });
  });
});

/** `markup()` without the file read, so the comment-stripping is testable. */
function markup0(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
