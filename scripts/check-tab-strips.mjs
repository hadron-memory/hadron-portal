#!/usr/bin/env node
/**
 * #858 — a horizontal tab strip in the portal's narrow content column must
 * scroll rather than push the page off a phone screen.
 *
 * The content column is ~308px at a 390px viewport. A strip of tabs wider than
 * that overflows the DOCUMENT unless the strip carries `overflow-x-auto`, and
 * unless each tab carries `shrink-0 whitespace-nowrap` — without those, flex
 * compresses the labels into unreadable columns instead of letting the strip
 * scroll. PR #746 established the fix on the App detail page; #854 found the
 * identical defect on the node detail page months later; #859 fixed four more,
 * one of which (`/app/account`) was overflowing the document by 10px and nobody
 * had noticed.
 *
 * Two instances of one class across a gap of months is the argument for a gate.
 *
 * ## Why this PARSES instead of grepping
 *
 * #859 shipped a stop-gap test that matched tokens against file source, and it
 * was decoration for three of the four files it covered: the COMMENTS
 * explaining each fix contained `overflow-x-auto`, `shrink-0` and
 * `whitespace-nowrap`, so deleting a real class left every assertion green.
 * Stripping comments fixes that much — but a regex still cannot answer the
 * question that matters, which is WHICH element scrolls. A file can carry the
 * token on an unrelated row while the actual strip has lost it.
 *
 * So this walks the Svelte AST and checks containment: for every tab found
 * under a rail, some element on the path from the rail DOWN TO that tab must
 * carry `overflow-x-auto`. `/app/assets` is why that path matters rather than
 * just the rail — its rail is a `justify-between` row and the scrolling element
 * is the inner `<nav>` holding the tabs.
 *
 * ## What counts as a tab strip
 *
 * Shape, not ARIA. An `role="tablist"`-keyed rule was tried on paper and is
 * WRONG here: the node detail page's strip is plain `<button>`s with no roles
 * at all, so it would miss the only page that was actually broken while
 * flagging one that was not.
 *
 *   rail — an element whose class carries `flex` and `border-b` (the underline
 *          rail every tab strip in this repo draws), but not `border-b-2`
 *   tab  — an `<a>` or `<button>` under that rail whose class carries
 *          `border-b-2` (the per-tab underline)
 *
 * A rail with two or more tabs is a strip. Two, not three: `/app/memories` and
 * `/app/orgs/[id]/agents` both have exactly two and both sat at exactly 308px
 * in a 308px column — one added tab or one longer translated label from
 * breaking.
 *
 * The pair is deliberately narrow. It does NOT fire on a segmented control
 * (`role="group"` with two buttons and no bottom rail) or a button row, which
 * are not tab strips and for which `overflow-x-auto` would be noise — per
 * `hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`,
 * a gate that over-fires grows an exclusion list, and an exclusion list is
 * where a real offender hides. This gate has no exclusion list.
 *
 * ## The caveat it enforces, stated because it is a real cost
 *
 * Setting `overflow-x` to a non-visible value forces the computed `overflow-y`
 * to `auto`. A strip rendering something VERTICALLY outside its box — a
 * dropdown, an absolutely-positioned badge — would begin clipping. Every strip
 * in this repo is plain text tabs (the orgs count badge rides inside its button
 * in normal inline flow), so none does. A future strip with a popover in it
 * should keep `shrink-0` on the tabs and suppress this check deliberately,
 * with a comment saying why — not by quietly widening the rail predicate.
 *
 * ## WHAT THIS GATE CANNOT SEE YET — read this before trusting a green run
 *
 * Measured on this commit: of TWENTY rails in `src/`, this predicate recognises
 * THREE as tab strips. It is not a filter that found 17 innocents; it is a
 * predicate that cannot see them. A green run therefore means "the 3 strips I
 * can parse are fine", NOT "every tab strip in the portal scrolls".
 *
 * The three it sees are `/app/apps/[appId]`, the node detail page (10 literal
 * tabs — this gate found and fixed that one), and `/app/orgs/[id]/agents`.
 *
 * Two blind spots account for all 17, and both are tracked on #858:
 *
 *   1. `{#each}` — a strip rendered from a loop is ONE `<a>`/`<button>` node in
 *      the AST however many tabs it renders, so `tabs.length < 2` skips it.
 *      Eight rails skip for this reason, including `/app/account`,
 *      `/app/memories` and `/app/assets` — the three strips #859 fixed. If any
 *      of them regressed tomorrow, this gate would stay green.
 *   2. A class token supplied by a script constant is invisible to `classText`,
 *      which reads the attribute's source slice only. `/app/orgs/[id]/memories`
 *      builds its tabs from a `subTabBase` constant holding `border-b-2`, so
 *      that rail reports zero tabs. Nine rails report zero tabs.
 *
 * Also unhandled: a Tailwind breakpoint variant satisfies these regexes —
 * `sm:overflow-x-auto` matches SCROLLS while being inactive at the phone width
 * this gate exists to protect.
 *
 * Until #858 closes those, do NOT read this gate's silence as coverage.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';

/** `border-b` but not `border-b-2` / `border-b-4`: `-` is a word boundary. */
const RAIL_BORDER = /\bborder-b(?![-\w])/;
const TAB_BORDER = /\bborder-b-2(?![-\w])/;
const FLEX = /\bflex(?![-\w])/;
const SCROLLS = /\boverflow-x-auto\b/;
const NO_SHRINK = /\bshrink-0\b/;
const NO_WRAP = /\bwhitespace-nowrap\b/;

/** Tags that can be a tab. */
const TAB_TAGS = new Set(['a', 'button']);

/**
 * The full text of an element's `class`, expressions included.
 *
 * Taken as a raw source slice rather than by reading Text nodes, because a
 * Svelte class is routinely part static and part interpolated —
 * `class="border-b-2 px-4 {active ? 'x' : 'y'}"` — and a token inside the
 * interpolation is still applied. Reading only the Text chunks would miss it
 * and the gate would demand a class the element already has.
 *
 * Returns '' for an element with no class at all, and for `class:foo` directives
 * (a different attribute type), which no strip in this repo uses for these
 * layout tokens.
 */
function classText(el, source) {
  const attr = (el.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'class');
  if (!attr) return '';
  if (attr.value === true) return '';
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  if (parts.length === 0) return '';
  const start = parts[0].start;
  const end = parts[parts.length - 1].end;
  return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';
}

/**
 * Every element in the template, each with the chain of element ancestors
 * above it — the chain is what makes the containment check possible.
 */
export function elementsWithAncestry(ast, source) {
  const found = [];
  const seen = new Set();
  const visit = (node, ancestors) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    let nextAncestors = ancestors;
    if (node.type === 'RegularElement') {
      const el = { name: node.name, cls: classText(node, source), start: node.start, ancestors };
      found.push(el);
      nextAncestors = [...ancestors, el];
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((c) => visit(c, nextAncestors));
      else if (value && typeof value === 'object' && 'type' in value) visit(value, nextAncestors);
    }
  };
  visit(ast.fragment, []);
  return found;
}

/**
 * One source, analysed: the strips this predicate could SEE, and the offences
 * among them. The two are returned together on purpose — a caller that reports
 * offences without reporting how many strips it recognised is reporting "no
 * problems found" when the honest claim is "nothing examined". That gap is what
 * the blind-spot note above is about, and `stripsSeen` is the number the gate's
 * own suite asserts on so the coverage cannot silently drop to zero.
 */
export function analyse(source) {
  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch {
    // A file this parser cannot read is not a silent pass: say so, so a syntax
    // change in the toolchain cannot turn the gate off without anyone noticing.
    return {
      stripsSeen: 0,
      offences: [{ kind: 'unparseable', detail: 'svelte/compiler could not parse this file' }],
    };
  }

  const all = elementsWithAncestry(ast, source);
  const rails = all.filter((e) => FLEX.test(e.cls) && RAIL_BORDER.test(e.cls) && !TAB_BORDER.test(e.cls));
  const out = [];
  let stripsSeen = 0;

  for (const rail of rails) {
    const tabs = all.filter(
      (e) => TAB_TAGS.has(e.name) && TAB_BORDER.test(e.cls) && e.ancestors.includes(rail),
    );
    if (tabs.length < 2) continue;
    stripsSeen += 1;

    // Containment: the scrolling element may be the rail itself or anything
    // between it and the tabs — `/app/assets` scrolls on an inner <nav>.
    const scrolls = tabs.every((tab) => {
      const path = [rail, ...tab.ancestors.slice(tab.ancestors.indexOf(rail) + 1)];
      return path.some((el) => SCROLLS.test(el.cls));
    });
    if (!scrolls) {
      out.push({ kind: 'strip-does-not-scroll', start: rail.start, tabs: tabs.length });
    }

    for (const tab of tabs) {
      if (!NO_SHRINK.test(tab.cls)) out.push({ kind: 'tab-can-shrink', start: tab.start });
      if (!NO_WRAP.test(tab.cls)) out.push({ kind: 'tab-can-wrap', start: tab.start });
    }
  }
  return { stripsSeen, offences: out };
}

/** Offences in one Svelte source. Exported for the gate's own test suite. */
export function offences(source) {
  return analyse(source).offences;
}

const MESSAGES = {
  'strip-does-not-scroll':
    'This tab strip has no `overflow-x-auto` on the rail or between it and the tabs, so at phone widths it pushes the page off the right edge instead of scrolling. See #858.',
  'tab-can-shrink':
    'This tab has no `shrink-0`, so flex compresses the labels into unreadable columns instead of letting the strip scroll. See #858.',
  'tab-can-wrap':
    'This tab has no `whitespace-nowrap`, so a long label wraps and the strip grows vertically rather than horizontally. See #858.',
  unparseable: 'This file could not be parsed, so the tab-strip gate could not check it. See #858.',
};

function lineOf(source, index) {
  return typeof index === 'number' ? source.slice(0, index).split('\n').length : 1;
}

function svelteFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) svelteFiles(full, acc);
    else if (entry.endsWith('.svelte')) acc.push(full);
  }
  return acc;
}

function main() {
  const files = svelteFiles('src');
  let failed = 0;
  let stripsSeen = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const { stripsSeen: seen, offences: found } = analyse(source);
    stripsSeen += seen;
    for (const o of found) {
      failed += 1;
      console.log(`::error file=${file},line=${lineOf(source, o.start)}::${MESSAGES[o.kind]}`);
    }
  }
  if (failed > 0) {
    console.log(`\n${failed} tab-strip problem(s) across ${files.length} .svelte files.`);
    process.exit(1);
  }
  // Report the DENOMINATOR, not just the verdict. "OK — every tab strip
  // scrolls" is the claim this gate cannot currently support: it recognises a
  // minority of the repo's rails, so silence over a strip it never parsed is
  // not evidence about that strip. See the blind-spot note at the top.
  console.log(
    `OK — the ${stripsSeen} tab strip(s) this gate can parse all scroll (${files.length} .svelte files).`,
  );
  console.log(
    'COVERAGE IS PARTIAL: strips built with {#each} or a shared class constant are invisible to this predicate. See #858.',
  );
}

// Only run when invoked directly, so the test suite can import the predicate.
if (process.argv[1] && process.argv[1].endsWith('check-tab-strips.mjs')) main();
