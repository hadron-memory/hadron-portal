#!/usr/bin/env node
/**
 * #781 — fail on a NEWLY ADDED bare-loc Hadron citation.
 *
 * CLAUDE.md requires citations to be fully qualified
 * (`hrn:node:<root>:<memory>:<loc>`), because a bare `review:some-check`
 * outlives the context that made it obvious: it gets pasted into a PR, a commit
 * message, or another repo's issue, where it no longer says which memory it
 * belongs to.
 *
 * Nothing mechanical enforced that, so the review bot was the only guard — and
 * it fires only after the code is written. It caught the same defect on four
 * consecutive PRs (#803 twice, #804, #806), one of them inside a comment
 * arguing for test rigour. Four in a row is a mechanism problem, not a run of
 * bad luck.
 *
 * ## Why ADDED LINES only
 *
 * There are ~79 pre-existing instances in `src/`, which #781 tracks. A gate
 * that failed on those could not land until that cleanup finished, and the
 * cleanup is the slow half. Checking only what a change ADDS stops the 80th
 * today and lets the backlog drain at its own pace.
 *
 * ## What it does NOT flag, and why each is enumerated
 *
 * Two kinds: `EXEMPT_FILES` (paths) and `isCitationContext` (prose only; not a
 * single-quoted sample value), plus an inline `bare-loc-ok` marker.
 * Both were measured rather than guessed: of 244 raw matches in this repo, 124
 * are fixture data in URN/wikilink parser tests and form documentation. Without
 * the context rules the gate would block every future edit to those parsers.
 *
 * An exemption is machinery that decides not to look, so every one of them is a
 * place a real citation can hide
 * (`hrn:node:hadronmemory.com:hadron-cli:review:an-exemption-you-cannot-enumerate-is-a-hiding-place`).
 * There is exactly one here — `EXEMPT_FILES`, this check and its own test —
 * and it is enumerated by exact path so it cannot widen by accident.
 *
 * Notably it does NOT exempt test files, which is where the obvious `**\/*.test.ts`
 * exclude would have gone: fixture URNs there (`urn:node:acme.com:kb:findings:flaky-ci`)
 * are handled by accepting the legacy `urn:` scheme, a property of the CITATION
 * rather than of where it lives. That matters because the citation @codex
 * actually caught was written in a test file, and a path-shaped exemption would
 * have hidden it.
 */

/** Hadron memory branch words that introduce a loc. */
export const BRANCH_WORDS = ['review', 'findings', 'conventions', 'tasks', 'ops', 'specs'];

/**
 * The ONLY exempt files: this check and its own test.
 *
 * Both exist to contain examples of the thing being detected, so they trip it
 * 18 times on a clean run — a gate that fails on itself cannot land.
 *
 * Enumerated by exact path rather than by a pattern, because an exemption is
 * machinery that decides not to look and every widening is a new hiding place
 * (`hrn:node:hadronmemory.com:hadron-cli:review:an-exemption-you-cannot-enumerate-is-a-hiding-place`).
 * A glob like `scripts/*.test.ts` or `**\/*.test.ts` would have hidden the real
 * citation @codex found in `mountComponent.client.test.ts` — test files are
 * deliberately NOT exempt.
 *
 * The cost is stated rather than hidden: a genuine bare citation written in
 * these two files is missed. They are 200 lines that one person edits when
 * touching this gate.
 */
export const EXEMPT_FILES = new Set([
  'scripts/check-bare-loc-citations.mjs',
  'scripts/check-bare-loc-citations.test.ts',
  // USER-FACING documentation whose subject IS loc/URN syntax. Exempted by path
  // rather than annotated inline, because a `bare-loc-ok` marker would leak a
  // CI concern into prose a reader is shown — the marker is for source
  // comments, and this file is shipped content.
  'src/lib/assets/hadron-instructions.md',
]);

/** Inline opt-out for prose that demonstrates loc syntax instead of citing. */
export const BARE_LOC_OK = 'bare-loc-ok';

const CITATION = new RegExp(`\\b(?:${BRANCH_WORDS.join('|')}):[a-z][a-z0-9-]*`, 'g');
// The contiguous URN-ish token a match sits inside.
const TOKEN_CHARS = /[A-Za-z0-9_.:-]/;

/**
 * Is the citation at `index` already fully qualified?
 *
 * Decided from the whole token it belongs to, not from the character before it.
 * A lookbehind for `:` would accept `hadron-server:findings:x` — which IS bare,
 * being a memory slug without the `hrn:node:` prefix that makes a reference
 * self-describing.
 */
function isQualified(line, index) {
  let start = index;
  while (start > 0 && TOKEN_CHARS.test(line[start - 1])) start--;
  const token = line.slice(start);
  return token.startsWith('hrn:node:') || token.startsWith('urn:node:');
}

/**
 * Is this match a CITATION, or is it data that merely looks like one?
 *
 * Added after the #781 cleanup measured the repo: of 244 matches, **124 were
 * not citations at all** — fixture locs in the URN/wikilink parser tests
 * (`loc: 'findings:x'`), sample values in docs that teach URN forms, and
 * partially-qualified examples. Flagging those would have blocked every future
 * edit to those parsers, and "rewriting" them corrupted the files twice during
 * the cleanup before this classifier existed.
 *
 * Two rules, each enumerated so the exemption cannot widen silently:
 *
 * 1. **Prose only.** A citation lives in a comment or a markdown file. A loc in
 *    executable code is a value under test. This is what #781's title says —
 *    *source COMMENTS cite Hadron nodes by bare loc*.
 * 2. **Not a single-quoted value.** Files documenting URN forms list them as
 *    `- bare loc: 'review:x'`. Qualifying one makes the label lie about its own
 *    example. Real citations here use backticks or bare parens.
 *
 * A memory-prefixed shorthand (`hadron-server:findings:x`, `dev:review:y`) is
 * deliberately NOT exempt (@codex). It is a SHORTENED citation and still lacks
 * the `hrn:node:` prefix, so it must be reported. That it cannot be rewritten
 * in place — the matched suffix alone yields `hadron-server:hrn:node:…` — is a
 * fact about the FIXER, and letting it leak into the DETECTOR meant three of
 * them would have gone unreported. This PR fixed those three by hand.
 *
 * The classifier is shared with the cleanup on purpose: CI flags exactly what a
 * cleanup would fix, so the two cannot disagree about what counts.
 */
export function isCitationContext(file, line, column, prevLine = '', forceProse = false) {
  // An explicit, visible opt-out for prose that DEMONSTRATES loc syntax rather
  // than citing a node — `hadron-instructions.md` teaching URN forms, or a
  // parser comment naming `findings:x` as a shape. Marked at the site rather
  // than exempted by path, so the exemption is readable where it applies and
  // cannot silently cover a real citation added to the same file later.
  if (line.includes(BARE_LOC_OK) || prevLine.includes(BARE_LOC_OK)) return false;
  const before = line.slice(0, column - 1);
  const isMarkdown = /\.(md|mdx)$/.test(file);
  // A CONTINUATION line of a multiline comment carries no opening delimiter
  // (@codex): `.svelte` files routinely write `<!-- …` then the citation on the
  // next line. A closing `-->` or `*/` anywhere on the line marks it as inside
  // one.
  //
  // That is still only line-local. The CLI does not rely on it: it calls
  // `scanAddedWithContext`, which tracks block state across the whole file and
  // passes `forceProse`, so a middle line with neither delimiter is classified
  // correctly. This heuristic remains for the pure-string `scanDiff` path.
  const inComment =
    /(^|\s)(\/\/|\*|#)/.test(before) ||
    before.includes('/*') ||
    before.includes('<!--') ||
    line.includes('-->') ||
    line.includes('*/');
  if (!isMarkdown && !inComment && !forceProse) return false;        // 1
  const openQuote = line.lastIndexOf("'", column - 1);               // 2
  if (
    openQuote !== -1 &&
    line.indexOf("'", column - 1) !== -1 &&
    !line.slice(openQuote + 1, column - 1).includes(' ')
  ) {
    return false;
  }
  return true;
}

/**
 * Bare citations in one line of source.
 * @param {string} line
 * @param {string} [file] — when given, non-citation contexts are filtered out.
 * @returns {{ text: string, column: number }[]}
 */
export function findBareCitations(line, file = '', prevLine = '', forceProse = false) {
  const out = [];
  for (const m of line.matchAll(CITATION)) {
    if (m.index === undefined) continue;
    if (isQualified(line, m.index)) continue;
    if (file && !isCitationContext(file, line, m.index + 1, prevLine, forceProse)) continue;
    out.push({ text: m[0], column: m.index + 1 });
  }
  return out;
}

/**
 * Which lines a unified diff ADDS, per file.
 * @returns {Map<string, Set<number>>}
 */
export function addedLinesByFile(diff) {
  const out = new Map();
  let file = null;
  let lineNumber = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { lineNumber = Number(hunk[1]); continue; }
    if (raw.startsWith('---') || !raw.startsWith('+')) continue;
    if (file) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file).add(lineNumber);
    }
    lineNumber += 1;
  }
  return out;
}

/**
 * Scan whole FILES for context, but report only the lines the diff added.
 *
 * The diff-only scanner cannot see block-comment state (@codex): with
 * `--unified=0` there are no context lines, so the middle line of a three-line
 * `<!-- … -->` has neither an opener nor a closer and reads as code. Reading
 * the file closes that properly instead of widening a heuristic — the citation
 * is classified with full context, and "added lines only" is preserved by
 * filtering afterwards rather than by looking at less.
 *
 * @param {string} diff
 * @param {(file: string) => string | null} readFile
 */
export function scanAddedWithContext(diff, readFile) {
  const findings = [];
  for (const [file, added] of addedLinesByFile(diff)) {
    if (EXEMPT_FILES.has(file)) continue;
    const text = readFile(file);
    if (text == null) continue;                       // deleted or binary
    const lines = text.split('\n');
    let inBlock = false;
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const startedInBlock = inBlock;
      // Track block state across the WHOLE file, so a continuation line is
      // known to be prose even with no delimiter of its own.
      let scan = line;
      for (;;) {
        if (!inBlock) {
          const open = Math.min(
            ...['/*', '<!--'].map((d) => { const j = scan.indexOf(d); return j === -1 ? Infinity : j; }),
          );
          if (open === Infinity) break;
          inBlock = true;
          scan = scan.slice(open + 2);
        } else {
          const close = Math.min(
            ...['*/', '-->'].map((d) => { const j = scan.indexOf(d); return j === -1 ? Infinity : j; }),
          );
          if (close === Infinity) break;
          inBlock = false;
          scan = scan.slice(close + 2);
        }
      }
      if (!added.has(lineNo)) return;
      const prose = startedInBlock || inBlock;
      for (const c of findBareCitations(line, file, lines[i - 1] ?? '', prose)) {
        findings.push({ file, lineNumber: lineNo, column: c.column, line: line.trim(), citation: c.text });
      }
    });
  }
  return findings;
}

/**
 * Scan a unified diff, reporting bare citations on ADDED lines only.
 *
 * Reads `+` lines and tracks the current file from `+++ b/…`. `+++` itself is
 * skipped explicitly — it starts with `+` and would otherwise be scanned as
 * content, which is the classic way a diff scanner reports its own header.
 *
 * Hunk headers (`@@ -a,b +c,d @@`) give the destination line number, so a
 * finding can name a real location instead of just a filename (@copilot). Only
 * added lines advance the counter, which is exactly right here: context lines
 * would too in a general-purpose parser, but this reads `--unified=0` diffs
 * where there are none.
 * @returns {{ file: string, lineNumber: number, column: number, line: string, citation: string }[]}
 */
export function scanDiff(diff) {
  const findings = [];
  let file = '(unknown)';
  let lineNumber = 0;
  // The previous ADDED line, so a marker can sit above a wrapped example.
  let prevAdded = '';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (b\/)?/, '');
      prevAdded = '';
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      // Adjacency is broken here, so the previous added line is no longer the
      // line ABOVE this one (@codex, @copilot). Without this reset a
      // `bare-loc-ok` at the end of one hunk silently suppressed the first
      // finding of the next — a marker leaking into unrelated code.
      prevAdded = '';
      continue;
    }
    if (raw.startsWith('---') || !raw.startsWith('+')) continue;
    const content = raw.slice(1);
    if (!EXEMPT_FILES.has(file)) {
      for (const c of findBareCitations(content, file, prevAdded)) {
        findings.push({
          file,
          lineNumber,
          column: c.column,
          line: content.trim(),
          citation: c.text,
        });
      }
    }
    lineNumber += 1;
    prevAdded = content;
  }
  return findings;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { execSync } = await import('node:child_process');
  const base = process.argv[2] ?? 'origin/main';
  // No pathspec (@copilot): the policy is repo-wide, so scoping to src/ +
  // scripts/ + CLAUDE.md quietly exempted docs, workflows and the README — the
  // authoring surfaces where a citation is MOST likely to be pasted onward.
  // A pathspec is an exemption wearing a different hat, and this one was not
  // enumerated anywhere.
  const diff = execSync(`git diff --unified=0 ${base}...HEAD`, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const { readFileSync } = await import('node:fs');
  const findings = scanAddedWithContext(diff, (f) => {
    try {
      const t = readFileSync(f, 'utf8');
      return t.includes('\0') ? null : t;
    } catch {
      return null;
    }
  });
  if (findings.length > 0) {
    // One annotation per finding so GitHub links each to its exact line;
    // `file=`/`line=`/`col=` is what turns a log entry into a jump target.
    for (const f of findings) {
      console.error(
        `::error file=${f.file},line=${f.lineNumber},col=${f.column}::Bare-loc Hadron citation \`${f.citation}\` — use the fully-qualified form (hrn:node:<root>:<memory>:<loc>). A bare loc does not say which memory it belongs to once pasted elsewhere. See #781.`,
      );
    }
    console.error(
      `\n${findings.length} bare-loc citation(s) added:\n` +
        findings.map((f) => `  ${f.file}:${f.lineNumber}  ${f.citation}\n    ${f.line}`).join('\n'),
    );
    process.exit(1);
  }
  console.log('OK — no newly added bare-loc citations.');
}
