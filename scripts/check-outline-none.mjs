#!/usr/bin/env node
/**
 * portal#1745 item 3 — refuse an `outline-none`/`outline-hidden` suppression on an element
 * that also carries `focus-visible:outline-*`, unless the suppression is focus-scoped AND
 * the same list re-states the outline style under focus-visible.
 *
 * Tailwind 4's `outline-none` sets `--tw-outline-style: none`, and every `outline-*`
 * utility draws with `outline-style: var(--tw-outline-style)`. When one element carries
 * both, the computed outline style on `:focus-visible` stays `none` and the focus ring
 * never paints — the accessibility intent of the class list is silently inverted. It has
 * shipped twice (#1619: the Task integrations heading; #1675: the ApplyAgentTickers
 * result region), and jsdom cannot see it (no Tailwind cascade), so both times every
 * component test stayed green
 * (hrn:node:hadronmemory.com:hadron-portal:review:unconditional-outline-none-hides-focus-ring).
 *
 * The rule this enforces is a bright line, the only kind a grep can hold: the DEFECT
 * SHAPE is an element whose class list contains BOTH a suppression (`outline-none`, or
 * `outline-hidden` — tailwind 4 sets `--tw-outline-style: none` for both; `outline-hidden`
 * only adds a forced-colors-only fallback outline) and a `focus-visible:outline*` utility
 * that wants to draw — unless the suppression is focus-scoped AND the same list re-states
 * the outline STYLE under focus-visible. The re-statement must be a STYLE utility
 * (`outline-solid`/`-dashed`/`-dotted`/`-double`) carrying the SAME extra variants as the
 * suppression: width/colour/offset utilities and bare `outline` draw WITH
 * `--tw-outline-style` and leave it `none` (bare `focus-visible:outline` emits exactly
 * `outline-style: var(--tw-outline-style); outline-width: 1px`), so
 * `focus:outline-none focus-visible:outline-2` still computes `outline-style: none` on
 * `:focus-visible` and the ring never paints (Gaia P2-1, portal#1751 BLIND review). A
 * restatement with DIFFERENT or extra variants only exists under a condition the
 * suppression is not bound by — in this repo `dark:` is class-scoped
 * (`:where(.dark, .dark *)` via `@custom-variant` in src/app.css) and `md:` is a width
 * media query, both verified in the compiled css — so `focus:outline-none
 * dark:focus-visible:outline-solid` paints nothing without `.dark`, and
 * `dark:focus:outline-none focus-visible:outline-solid` loses dark mode outright (the
 * dark suppression sorts AFTER the plain restatement at equal specificity; Gaia P3-1,
 * confirmed P2-grade, portal#1751 BLIND delta). A suppression scoped to `focus-visible`
 * itself is refused outright: any restatement beside it shares its variant, equal
 * specificity makes tailwind's utility sort order the judge, and that order is not a
 * contract — in the compiled css `outline-none` sorts after dashed/dotted/double but
 * BEFORE `solid`, so the pair's outcome flips by which style utility is picked (Gaia
 * P3-1 same-variant pair; the solid flip confirmed on her 5b7e1afe delta). A
 * suppression paired only with `focus-visible:ring-*`
 * (box-shadow ring) is NOT the pair — the outline is hidden on purpose, with
 * outline-hidden's forced-colors fallback (Gaia P2, portal#1751 BLIND delta). The fixed
 * spellings (`focus:outline-none focus-visible:outline-solid …` and its inverse
 * ordering, and the extras-matched `dark:focus:outline-none
 * dark:focus-visible:outline-solid`) are accepted; so is a bare `outline-none` on an
 * element with no `focus-visible:outline*` at all (nothing is being
 * suppressed-then-drawn).
 *
 * ## What it does NOT look at, and why each silence is enumerated
 *
 * It reads `class="…"` / `class='…'` attribute spans only, one line at a time:
 *
 *  - **Dynamic class expressions** (`class={…}`, `class:directive`) and **class lists
 *    assembled in TS string constants** are not parsed. Both shipped defects were plain
 *    attributes; a grep that guesses at expression semantics flags prose and misses
 *    real lists at the same time.
 *  - **Multi-line class attributes** escape the line-local read. Both shipped defects
 *    were single-line; the repo's formatting keeps them so.
 *  - **Bracket variant chains** (`[&>*]:outline-none`) and **trailing modifiers**
 *    (`outline-none/50`) are not parsed as tokens.
 *
 * ## Which FILES it reads (portal#2264: the pre-filter, enumerated and pinned)
 *
 * The scan walks `src/` and reads only the extensions in `SCANNED_EXTS`. Every other
 * extension the repo ships under `src/` is named in `EXCLUDED_EXTS` with its reason, and
 * `unclassifiedExtensions` makes a new extension (a `.vue`, a `.tsx`, an `.svg` with
 * classes) fail the test until someone classifies it — the filter can no longer pass a
 * file by omission. `.html` is scanned because `src/app.html` is markup the app ships and
 * the class-attribute read applies to it unchanged. The scripts test also pins that no
 * excluded-extension file under `src/` carries an `outline-none`/`outline-hidden` token
 * at all, so each exclusion is proven empty today, not assumed.
 *
 * Each is a place the broken spelling can hide; if one starts appearing in real class
 * lists, widen the read in the same PR that introduces it — the mutant test below pins
 * both directions (broken spelling flagged, main as-is clean).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * A `focus-visible:outline*` utility that wants to DRAW: bare `focus-visible:outline`
 * (which emits `outline-style: var(--tw-outline-style); outline-width: 1px` per the
 * installed tailwindcss — it draws WITH the variable, so a suppression beats it; Gaia
 * P3-2, portal#1751 BLIND delta) or any `outline-<width/colour/offset/style>` except
 * the two suppressions — neither counts, so the valid ring-based pattern
 * `focus-visible:outline-hidden focus-visible:ring-2` — outline intentionally hidden
 * with its forced-colors fallback, the ring drawn by `ring-*` — is not a pair at all
 * (Gaia P2, portal#1751 BLIND delta at 8676d593).
 */
const WANTS_RING = /^(?:[\w()-]+:)*focus-visible:outline(?:-(?!(?:none|hidden)\b)|$)/;

/**
 * The outline STYLE utilities that set `--tw-outline-style` back to a painting value
 * (tailwind 4 emits exactly solid/dashed/dotted/double). Only these re-state the ring
 * after a scoped suppression; width/colour/offset utilities and bare `outline` draw
 * WITH the variable and leave it whatever the suppression set. The token must carry
 * exactly a `focus-visible:` scope and the suppression's OWN extra variants — a
 * differently-conditioned restatement does not exist where the suppression does
 * (this repo's `dark:` is `:where(.dark, .dark *)`, `md:` is a width media query;
 * verified in the compiled css), and an extras-carrying suppression beats a plain
 * restatement that sorts earlier at equal specificity
 * (`dark:focus:outline-none` after `focus-visible:outline-solid` — Gaia P3-1,
 * portal#1751 BLIND delta).
 */
const STYLE = '(?:solid|dashed|dotted|double)';
const RESTATES_STYLE = new RegExp(`^focus-visible:outline-${STYLE}$`);

/** The restatement an extras-carrying `focus:`-scoped suppression requires: same extras, same order, focus-visible scope. */
const restatementFor = (extras) => new RegExp(
  `^${extras.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(':')}${extras.length ? ':' : ''}focus-visible:outline-${STYLE}$`,
);

/** A suppression token — `outline-none`, or `outline-hidden` (same variable; forced-colors fallback) — with its variant chain. */
const SUPPRESSES = /^((?:[\w()-]+:)*)(outline-none|outline-hidden)$/;

/** Why a token is the defect, in one sentence for the CI annotation. */
const REASON = {
  unscoped:
    'the suppression is not focus-scoped — the bright line refuses it even where a focus-visible:outline-<style> restatement would out-rank it by specificity — scope it (focus:outline-none) and add or keep the focus-visible:outline-solid restatement',
  noRestatement:
    'the suppression is focus-scoped but nothing safely re-states the outline STYLE — the restatement must be focus-visible:outline-<style> carrying the suppression\'s OWN extra variants (dark:focus:outline-none needs dark:focus-visible:outline-solid; a plain one sorts earlier at equal specificity, so the conditioned scheme/viewport keeps style:none); width/colour alone draw with --tw-outline-style, which the suppression left at none',
  sameVariant:
    'the suppression is scoped to focus-visible, the same variant as any style restatement beside it — equal specificity leaves the winner to tailwind\'s utility sort order, not class order, and that order flips by style: dashed/dotted/double lose to outline-none while solid beats it (compiled css), so the pair is indeterminate by contract — use focus:outline-none with a focus-visible:outline-<style> restatement instead',
};

/**
 * The outline-none traps in one line of source: every class attribute whose list carries
 * both a draw-wanting `focus-visible:outline*` token and a suppression token that is
 * either not scoped to a focus variant at all, focus-scoped without a matching
 * focus-visible outline-STYLE restatement elsewhere in the same list, or scoped to
 * focus-visible itself (where no restatement can sit safely beside it).
 *
 * @param {string} line
 * @returns {{ column: number, token: string, line: string, reason: 'unscoped' | 'noRestatement' | 'sameVariant' }[]}
 */
export function findOutlineNoneTrap(line) {
  const out = [];
  for (const match of line.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/g)) {
    const [, , value] = match;
    const tokens = value.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => WANTS_RING.test(t))) continue;
    for (const token of tokens) {
      const m = SUPPRESSES.exec(token);
      if (!m) continue;
      const chain = m[1] ? m[1].split(':').filter(Boolean) : [];
      const last = chain[chain.length - 1];
      // An empty chain (the bare utility) or a non-focus variant is the defect outright;
      // a chain ending in focus is only safe when the same list re-states the outline
      // STYLE under focus-visible with the chain's own extra variants; a chain ending
      // in focus-visible is never safe — its restatement would share the variant.
      if (last === 'focus') {
        const re = chain.length > 1 ? restatementFor(chain.slice(0, -1)) : RESTATES_STYLE;
        if (tokens.some((t) => re.test(t))) continue;
        out.push({ column: match.index + 1, token, line: line.trim(), reason: 'noRestatement' });
        continue;
      }
      if (last === 'focus-visible') {
        out.push({ column: match.index + 1, token, line: line.trim(), reason: 'sameVariant' });
        continue;
      }
      out.push({ column: match.index + 1, token, line: line.trim(), reason: 'unscoped' });
    }
  }
  return out;
}

/** The extensions the guard reads: markup and script that carry `class="…"` attributes. */
export const SCANNED_EXTS = ['.svelte', '.ts', '.js', '.html'];

/**
 * The extensions the guard deliberately does not read, each with its reason. A new
 * extension under `src/` must land in one of the two lists (`unclassifiedExtensions`).
 */
export const EXCLUDED_EXTS = {
  '.css':
    'stylesheets carry no class="…" attribute for this read to parse; no `@apply` of outline-none exists under src/ (pinned: no excluded file holds the token), so widen the read in the PR that adds one',
  '.md':
    'prose and skill text bundled as assets, never rendered as elements with class lists; pinned token-free',
  '.yml':
    'sample configuration data, not markup; pinned token-free',
  '.json':
    'wire fixtures and data, not markup; pinned token-free',
};

/** Every extension present on a file under `root`, sorted. */
export function extensionsUnder(root) {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.add(extname(path));
    }
  };
  walk(root);
  return [...found].sort();
}

/** Extensions under `root` that are neither scanned nor excluded-with-a-reason. */
export function unclassifiedExtensions(root) {
  return extensionsUnder(root).filter(
    (e) => e && !SCANNED_EXTS.includes(e) && !Object.hasOwn(EXCLUDED_EXTS, e),
  );
}

/** Every file under `root` with a scanned extension, recursively. */
export function sourceFilesUnder(root, exts = SCANNED_EXTS) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (exts.some((e) => path.endsWith(e))) files.push(path);
    }
  };
  walk(root);
  return files;
}

/**
 * Scan whole files, reporting per line.
 * @param {string[]} files
 * @param {(file: string) => string | null} readFile
 */
export function scanFiles(files, readFile) {
  const findings = [];
  for (const file of files) {
    const text = readFile(file);
    if (text == null || text.includes('\0')) continue; // missing or binary
    text.split('\n').forEach((line, i) => {
      for (const f of findOutlineNoneTrap(line)) {
        findings.push({ file, lineNumber: i + 1, column: f.column, token: f.token, line: f.line, reason: f.reason });
      }
    });
  }
  return findings;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? 'src';
  const findings = scanFiles(sourceFilesUnder(root), (f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return null;
    }
  });
  if (findings.length > 0) {
    for (const f of findings) {
      console.error(
        `::error file=${f.file},line=${f.lineNumber},col=${f.column}::\`${f.token}\` beside focus-visible:outline-* — ${REASON[f.reason]}. See #1745, #1619, #1675.`,
      );
    }
    console.error(
      `\n${findings.length} outline-none trap(s):\n` +
        findings.map((f) => `  ${f.file}:${f.lineNumber}  ${f.token} (${f.reason})\n    ${f.line}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(`OK — no suppression trap beside focus-visible:outline-* (${sourceFilesUnder(root).length} files under ${root}).`);
}
