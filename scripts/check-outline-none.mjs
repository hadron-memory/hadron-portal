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
 * only adds a forced-colors-only fallback outline) and a `focus-visible:outline-*` utility
 * that wants to draw — unless the suppression is focus-scoped AND the same list re-states
 * the outline STYLE under focus-visible (`focus-visible:outline-solid` and siblings). The
 * re-statement must be a STYLE utility: width/colour/offset utilities and bare `outline`
 * draw WITH `--tw-outline-style` and leave it `none`, so `focus:outline-none
 * focus-visible:outline-2` still computes `outline-style: none` on `:focus-visible` and
 * the ring never paints (Gaia P2-1, portal#1751 BLIND review). The fixed spellings
 * (`focus:outline-none focus-visible:outline-solid …` and its inverse ordering) are
 * accepted; so is a bare `outline-none` on an element with no `focus-visible:outline-*`
 * at all (nothing is being suppressed-then-drawn).
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
 * Each is a place the broken spelling can hide; if one starts appearing in real class
 * lists, widen the read in the same PR that introduces it — the mutant test below pins
 * both directions (broken spelling flagged, main as-is clean).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A `focus-visible:outline-*` utility that wants to DRAW (so `outline-none` itself doesn't count). */
const WANTS_RING = /^(?:[\w()-]+:)*focus-visible:outline-(?!none\b)/;

/**
 * The outline STYLE utilities that set `--tw-outline-style` back to a painting value
 * (tailwind 4 emits exactly solid/dashed/dotted/double). Only these re-state the ring
 * after a scoped suppression; width/colour/offset utilities and bare `outline` draw
 * WITH the variable and leave it whatever the suppression set.
 */
const RESTATES_STYLE = /^(?:[\w()-]+:)*focus-visible:outline-(?:solid|dashed|dotted|double)$/;

/** A suppression token — `outline-none`, or `outline-hidden` (same variable; forced-colors fallback) — with its variant chain. */
const SUPPRESSES = /^((?:[\w()-]+:)*)(outline-none|outline-hidden)$/;

/** Variants that legitimately scope the suppression to focus. */
const FOCUS_SCOPES = new Set(['focus', 'focus-visible']);

/** Why a token is the defect, in one sentence for the CI annotation. */
const REASON = {
  unscoped:
    'the suppression is not focus-scoped, so it wins under :focus-visible outright — scope it (focus:outline-none) and re-state focus-visible:outline-solid',
  noRestatement:
    'the suppression is focus-scoped but the list never re-states the outline STYLE under focus-visible — width/colour alone (focus-visible:outline-2) draw with --tw-outline-style, which the suppression left at none, so the ring never paints; add focus-visible:outline-solid (Gaia P2-1, portal#1751 BLIND)',
};

/**
 * The outline-none traps in one line of source: every class attribute whose list carries
 * both a draw-wanting `focus-visible:outline-*` token and a suppression token that is
 * either not scoped to a focus variant at all, or focus-scoped without a focus-visible
 * outline-STYLE restatement elsewhere in the same list.
 *
 * @param {string} line
 * @returns {{ column: number, token: string, line: string, reason: 'unscoped' | 'noRestatement' }[]}
 */
export function findOutlineNoneTrap(line) {
  const out = [];
  for (const match of line.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/g)) {
    const [, , value] = match;
    const tokens = value.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => WANTS_RING.test(t))) continue;
    const restated = tokens.some((t) => RESTATES_STYLE.test(t));
    for (const token of tokens) {
      const m = SUPPRESSES.exec(token);
      if (!m) continue;
      const chain = m[1] ? m[1].split(':').filter(Boolean) : [];
      const last = chain[chain.length - 1];
      // An empty chain (the bare utility) or a non-focus variant is the defect outright;
      // a chain ending in focus/focus-visible is only safe when the same list re-states
      // the outline STYLE under focus-visible.
      if (last !== undefined && FOCUS_SCOPES.has(last)) {
        if (restated) continue;
        out.push({ column: match.index + 1, token, line: line.trim(), reason: 'noRestatement' });
        continue;
      }
      out.push({ column: match.index + 1, token, line: line.trim(), reason: 'unscoped' });
    }
  }
  return out;
}

/** Every file under `root` with a source extension, recursively. */
export function sourceFilesUnder(root, exts = ['.svelte', '.ts', '.js']) {
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
