#!/usr/bin/env node
/**
 * #820 — a grid with a LOSSY accessor must not use TanStack's `includesString`.
 *
 * `includesString` stringifies the ACCESSOR value. Two of this repo's column
 * conventions guarantee that is not what the cell shows:
 *
 *   - a date accessor returns epoch millis so the column sorts by instant
 *     (`hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant`);
 *   - numeric accessors keep counts, sizes and ids sorting numerically
 *     (`hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions`).
 *
 * So the searchable value becomes `1757145600000` while the reader is looking
 * at `9/6/2026`, and the search box gives no hint that it is comparing
 * something else. `makeGlobalFilterFn` ($lib/table/global-filter) resolves it at
 * the filter, matching the rendered text, the accessor value, or extra text
 * read from the original row.
 *
 * WHY A GATE RATHER THAN A DEFAULT. The obvious alternative is to make
 * `createSvelteTable` default to `makeGlobalFilterFn`, and it would not have
 * prevented this: the fix is the per-column `fmt`/`extras` map, which only the
 * grid can supply. A default with an empty map behaves exactly like
 * `includesString` on precisely the columns that are broken. So what is worth
 * enforcing is that the DECISION was made, and that is what this checks.
 *
 * Deliberately FILE-scoped rather than per-table, and that is not only a
 * simplification: #820's sweep left the second grid in two files on the old
 * filter, and a file-scoped check is what caught it. Pinpointing which of two
 * `createSvelteTable` calls owns a given accessor needs a parser; the
 * false-positive cost is one swapped filter on a grid that did not strictly
 * need it, which is harmless and keeps a page consistent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const INCLUDES_STRING = "globalFilterFn: 'includesString'";

/**
 * Accessors whose value is NOT what the cell renders.
 *
 * Epoch and elapsed millis are the two the conventions above mandate; the rest
 * are the shapes a count/size/id accessor takes in this repo today. The list is
 * deliberately conservative — it names shapes that were MEASURED as lossy in
 * #820 rather than guessing at every numeric expression, because a gate that
 * over-fires gets an exclusion list, and an exclusion list is where a real one
 * hides (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */
export const LOSSY_ACCESSOR = [
  /accessorFn:[^\n]*\b\w*[Dd]ateMs\(/, // dateMs(...), keyDateMs(...), revisionDateMs(...)
  /accessorFn:[^\n]*\bdurationMs\(/,
  /accessorFn:[^\n]*\b\w+\.\w*(Ms|MS)\b/, // row.uploadedMs, row.startedMs
  /accessorFn:[^\n]*\.getTime\(\)/,
  /accessorFn:[^\n]*Date\.parse\(/,
  /accessorFn:[^\n]*\?\? 0\) \+ /, // summed token counts
  /accessorFn:[^\n]*\.length \+ /, // derived counts
  /accessorFn:[^\n]*\b\w+\.sizeBytes\b/,
];

/** Every lossy accessor in a source file, with its line number. */
export function lossyAccessors(source) {
  const lines = source.split('\n');
  return lines.flatMap((text, i) =>
    LOSSY_ACCESSOR.some((pattern) => pattern.test(text)) ? [{ line: i + 1, text: text.trim() }] : [],
  );
}

/**
 * The offence, or null.
 *
 * Both halves are required: `includesString` on a grid whose accessors all
 * render as themselves is fine, and a lossy accessor behind
 * `makeGlobalFilterFn` is the fix rather than the defect.
 */
export function scanSource(file, source) {
  if (!source.includes(INCLUDES_STRING)) return null;
  const lossy = lossyAccessors(source);
  if (lossy.length === 0) return null;

  const filterLine = source.split('\n').findIndex((l) => l.includes(INCLUDES_STRING)) + 1;
  return { file, filterLine, lossy };
}

export function svelteFilesUnder(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.svelte')) files.push(path);
    }
  })(root);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = svelteFilesUnder('src');
  const offenders = files
    .map((file) => scanSource(file, readFileSync(file, 'utf8')))
    .filter((hit) => hit !== null);

  if (offenders.length === 0) {
    console.log(`OK — no grid pairs 'includesString' with a lossy accessor (${files.length} components scanned).`);
  } else {
    for (const { file, filterLine, lossy } of offenders) {
      // `file=`/`line=` is what turns a log entry into a jump target.
      console.error(
        `::error file=${file},line=${filterLine}::globalFilterFn: 'includesString' searches the ACCESSOR, and this file has an accessor whose value is not what the cell renders — so the text on screen is unsearchable. Use makeGlobalFilterFn from $lib/table/global-filter. See #820.`,
      );
      for (const hit of lossy.slice(0, 3)) console.error(`    ${file}:${hit.line}  ${hit.text}`);
    }
    console.error(`\n${offenders.length} grid file(s) searching something the reader cannot see.`);
    process.exit(1);
  }
}
