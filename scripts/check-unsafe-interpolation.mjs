#!/usr/bin/env node
/**
 * #817 — no `.replace('{placeholder}', value)` interpolation outside the i18n
 * boundary.
 *
 * `String.prototype.replace` expands `$&`, `` $` ``, `$'` and `$1`…`$9` **in the
 * replacement string**, and every value this portal interpolates is user- or
 * server-supplied — filenames, node and memory names, wikilink targets, and
 * `Asset.scanSignature` straight from the scan engine:
 *
 *     'Signature: {sig}'.replace('{sig}', 'Eicar$&Test')  → 'Signature: Eicar{sig}Test'
 *     'Download {file}'.replace('{file}', 'a$`b.txt')     → 'Download aDownload b.txt'
 *
 * `$&` is the matched text, so the PLACEHOLDER reappears inside the value. Not
 * an injection — the output is escaped as text — but it silently corrupts what
 * is displayed, including ACCESSIBLE NAMES, where the reader has no visible
 * copy to compare against.
 *
 * `t(id, text, vars)` and `fill(template, vars)` substitute through a replacer
 * FUNCTION, whose return value is used verbatim. After #817 there is no
 * legitimate placeholder `.replace` left in `src/`, so this is a bright line
 * rather than a judgement call — which is the only kind of rule a grep can
 * hold.
 *
 * WHY THIS EXISTS AT ALL. #814 fixed two call sites with a per-site callback
 * and left 33; the repo then stated the rule in a code comment, where nothing
 * ran it. The remedy that scales is not a better comment, it is a boundary plus
 * a check that the boundary is the only door.
 *
 * COMMENTS ARE EXEMPT, and that exemption is load-bearing rather than a
 * convenience: the clearest way to document this defect is to show the broken
 * call, and two comments in `src/` deliberately do. The #817 sweep's own
 * automated pass rewrote those examples into nonsense before it was caught —
 * so the check that guards the rule must not punish the prose that teaches it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** `.replace('{key}', …)` and `.replace(/\{key\}/g, …)`. */
export const UNSAFE_INTERPOLATION = /\.replace\(\s*(?:'\{\w+\}'|"\{\w+\}"|\/\\\{\w+\\\}\/[a-z]*)\s*,/;

/** The i18n boundary itself, which owns the safe implementation. */
export const EXEMPT_FILES = ['src/lib/i18n/t.ts'];

/**
 * Is this occurrence inside a comment?
 *
 * Line comments and the continuation lines of a block comment. A placeholder
 * `.replace` inside a template literal or a string would be a false positive in
 * principle; there are none in this repo, and inventing an exemption for a case
 * that does not exist is how a gate acquires a hiding place
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */
export function inComment(line, index) {
  const before = line.slice(0, index);
  const trimmed = before.trimStart();
  return before.includes('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Every unsafe interpolation in a source file, with its line number. */
export function findUnsafeInterpolation(source) {
  return source.split('\n').flatMap((line, i) => {
    const match = UNSAFE_INTERPOLATION.exec(line);
    if (!match || inComment(line, match.index)) return [];
    return [{ line: i + 1, text: line.trim() }];
  });
}

export function sourceFilesUnder(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if ((path.endsWith('.svelte') || path.endsWith('.ts')) && !path.includes('.test.')) files.push(path);
    }
  })(root);
  return files.filter((f) => !EXEMPT_FILES.includes(f));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = sourceFilesUnder('src');
  const offenders = files.flatMap((file) =>
    findUnsafeInterpolation(readFileSync(file, 'utf8')).map((hit) => ({ file, ...hit })),
  );

  if (offenders.length === 0) {
    console.log(`OK — no unsafe placeholder interpolation (${files.length} files scanned).`);
  } else {
    for (const { file, line, text } of offenders) {
      console.error(
        `::error file=${file},line=${line}::\`.replace('{…}', value)\` expands $& and friends out of the VALUE, corrupting what is displayed — including accessible names. Pass vars to t() instead: t(id, text, { key: value }), or fill(template, vars). See #817.`,
      );
      console.error(`    ${file}:${line}  ${text}`);
    }
    console.error(`\n${offenders.length} unsafe interpolation(s).`);
    process.exit(1);
  }
}
