#!/usr/bin/env node
/**
 * #817 — no `.replace('{placeholder}', value)` interpolation outside the i18n
 * boundary.
 *
 * `String.prototype.replace` expands `$&`, `` $` ``, `$'` and `$1`…`$9` **in the
 * replacement string**, and every value this portal interpolates is user- or
 * server-supplied — filenames, node and memory names, wikilink targets, OAuth
 * client ids, and `Asset.scanSignature` straight from the scan engine:
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
 * rather than a judgement call — which is the only kind of rule a grep can hold.
 *
 * ## Two review findings on #830, and both were about the CHECK, not the sweep
 *
 * The first version matched line by line and treated any `//` on the line as a
 * comment start. Both are why this one works on the whole file instead:
 *
 *  - **@codex:** a call formatted across lines — `.replace(` on one line, the
 *    placeholder on the next — could not match at all. Three real sites were
 *    live in `src/` while the gate printed `OK`, which is worse than no gate:
 *    it is a green light over the exact defect. Prettier splits any call that
 *    exceeds the print width, so the formatted shape is not an edge case, it is
 *    what the formatter produces for long strings.
 *  - **@copilot:** `before.includes('//')` treats the `//` in a `https://` URL
 *    earlier on the line as a comment start, so any line containing a URL was
 *    silently exempt. A bypass nobody would ever write on purpose and anyone
 *    could write by accident.
 *
 * So comments are located with a scanner that knows what a string is, and are
 * BLANKED rather than removed — offsets stay put, so line numbers stay true.
 * Strings are deliberately left intact, because the placeholder this hunts for
 * IS a string literal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `.replace('{key}', …)`, `.replace("{key}", …)` and `.replace(/\{key\}/g, …)`,
 * with any whitespace — NEWLINES INCLUDED — between the pieces.
 */
export const UNSAFE_INTERPOLATION = /\.replace\(\s*(?:'\{\w+\}'|"\{\w+\}"|\/\\\{\w+\\\}\/[a-z]*)\s*,/g;

/** The i18n boundary itself, which owns the safe implementation. */
export const EXEMPT_FILES = ['src/lib/i18n/t.ts'];

/**
 * Replace comment bodies with spaces, preserving length and newlines.
 *
 * String-aware, which is the whole point: `'https://x'` must not start a
 * comment, and a `//` inside a template literal must not either. Escapes are
 * honoured so `'\''` does not end the string early.
 *
 * Regex literals are NOT tracked. A `/` that opens one is only ambiguous with a
 * comment when followed by another `/`, and `//` cannot open a regex literal —
 * so the ambiguity this would resolve does not arise. Stated rather than left
 * as an unexamined gap.
 */
export function blankComments(source) {
  let out = '';
  let i = 0;
  let inString = null;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (inString) {
      if (c === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      out += c;
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      inString = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) out += source[i] === '\n' ? '\n' : ' ';
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/** Every unsafe interpolation in a source file, with its line number. */
export function findUnsafeInterpolation(source) {
  const code = blankComments(source);
  const hits = [];
  UNSAFE_INTERPOLATION.lastIndex = 0;
  let match;
  while ((match = UNSAFE_INTERPOLATION.exec(code)) !== null) {
    const line = code.slice(0, match.index).split('\n').length;
    hits.push({ line, text: source.split('\n')[line - 1].trim() });
  }
  return hits;
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
