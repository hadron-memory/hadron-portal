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
 * ## Exemptions, and why there is only one
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
]);

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
 * Bare citations in one line of source.
 * @returns {{ text: string, column: number }[]}
 */
export function findBareCitations(line) {
  const out = [];
  for (const m of line.matchAll(CITATION)) {
    if (m.index === undefined) continue;
    if (isQualified(line, m.index)) continue;
    out.push({ text: m[0], column: m.index + 1 });
  }
  return out;
}

/**
 * Scan a unified diff, reporting bare citations on ADDED lines only.
 *
 * Reads `+` lines and tracks the current file from `+++ b/…`. `+++` itself is
 * skipped explicitly — it starts with `+` and would otherwise be scanned as
 * content, which is the classic way a diff scanner reports its own header.
 * @returns {{ file: string, line: string, citation: string }[]}
 */
export function scanDiff(diff) {
  const findings = [];
  let file = '(unknown)';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    if (raw.startsWith('---') || !raw.startsWith('+')) continue;
    if (EXEMPT_FILES.has(file)) continue;
    const content = raw.slice(1);
    for (const c of findBareCitations(content)) {
      findings.push({ file, line: content.trim(), citation: c.text });
    }
  }
  return findings;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { execSync } = await import('node:child_process');
  const base = process.argv[2] ?? 'origin/main';
  const diff = execSync(`git diff --unified=0 ${base}...HEAD -- src/ scripts/ CLAUDE.md`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const findings = scanDiff(diff);
  if (findings.length > 0) {
    console.error(
      `::error::${findings.length} bare-loc Hadron citation(s) added. CLAUDE.md requires the fully-qualified form (hrn:node:<root>:<memory>:<loc>) — a bare loc does not say which memory it belongs to once it is pasted elsewhere. See #781.`,
    );
    for (const f of findings) console.error(`  ${f.file}: ${f.citation}\n    ${f.line}`);
    process.exit(1);
  }
  console.log('OK — no newly added bare-loc citations.');
}
