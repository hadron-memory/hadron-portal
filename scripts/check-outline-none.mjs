#!/usr/bin/env node
/**
 * portal#1745 item 3 — refuse a bare `outline-none` on an element that also carries
 * `focus-visible:outline-*`.
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
 * SHAPE is an element whose class list contains BOTH an `outline-none` that is not
 * scoped to a focus variant AND a `focus-visible:outline-*` utility. The fixed
 * spellings (`focus:outline-none focus-visible:outline-solid …` and its inverse
 * ordering) are accepted; so is a bare `outline-none` on an element with no
 * `focus-visible:outline-*` at all (nothing is being suppressed-then-drawn).
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

/** `outline-none` with its variant chain, if the token is exactly that utility. */
const OUTLINE_NONE = /^((?:[\w()-]+:)*)outline-none$/;

/** Variants that legitimately scope the suppression to focus. */
const FOCUS_SCOPES = new Set(['focus', 'focus-visible']);

/**
 * The outline-none traps in one line of source: every class attribute whose list carries
 * both a draw-wanting `focus-visible:outline-*` token and an `outline-none` token whose
 * variant chain does not end in a focus scope.
 *
 * @param {string} line
 * @returns {{ column: number, token: string, line: string }[]}
 */
export function findOutlineNoneTrap(line) {
  const out = [];
  for (const match of line.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/g)) {
    const [, , value] = match;
    const tokens = value.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => WANTS_RING.test(t))) continue;
    for (const token of tokens) {
      const m = OUTLINE_NONE.exec(token);
      if (!m) continue;
      const chain = m[1] ? m[1].split(':').filter(Boolean) : [];
      const last = chain[chain.length - 1];
      // An empty chain (the bare utility) or a non-focus variant is the defect; only a
      // chain ending in focus/focus-visible is the scoped suppression the fix uses.
      if (last !== undefined && FOCUS_SCOPES.has(last)) continue;
      out.push({ column: match.index + 1, token, line: line.trim() });
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
        findings.push({ file, lineNumber: i + 1, column: f.column, token: f.token, line: f.line });
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
        `::error file=${f.file},line=${f.lineNumber},col=${f.column}::Bare \`${f.token}\` beside focus-visible:outline-* — Tailwind 4 leaves --tw-outline-style:none under :focus-visible, so the focus ring never paints. Scope the suppression (focus:outline-none) and re-state focus-visible:outline-solid. See #1745, #1619, #1675.`,
      );
    }
    console.error(
      `\n${findings.length} outline-none trap(s):\n` +
        findings.map((f) => `  ${f.file}:${f.lineNumber}  ${f.token}\n    ${f.line}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(`OK — no bare outline-none beside focus-visible:outline-* (${sourceFilesUnder(root).length} files under ${root}).`);
}
