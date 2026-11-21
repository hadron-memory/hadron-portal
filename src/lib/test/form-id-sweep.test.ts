/**
 * #1320 — every route that mounts more than one Superform must have its loader
 * pinned with expectDistinctFormIds.
 *
 * The audit this replaces was a hand-kept table, and it drifted: LOCAL found
 * Memory Integrations, org Agents, org Integrations, invite and node-edge
 * detail missing from it. So the inventory is derived from source instead. A
 * route is multi-form when its LOADER (the part of +page.server.ts before
 * `export const actions`) calls superValidate twice or more, or when a
 * +page.svelte beside it calls superForm twice or more. Each such directory
 * must hold a test that calls expectDistinctFormIds.
 *
 * Adding a second form to a page, or a new multi-form page, fails this test
 * until the page's loader is guarded; there is no table to forget to update.
 *
 * Limit: this is a lexical backstop, not a semantic guard. It counts direct
 * superValidate/superForm calls and recognises an expectDistinctFormIds call by
 * its text in a sibling test. A refactor that moves form creation into a helper
 * hides the forms from the count, and the sweep stays green; a route that does
 * that must be pinned by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = join(process.cwd(), 'src/routes');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

export function multiFormDirs(files: string[], read: (p: string) => string = (p) => readFileSync(p, 'utf8')): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const dir = f.slice(0, f.lastIndexOf('/'));
    if (/\/\+(page|layout)\.server\.ts$/.test(f)) {
      const src = read(f);
      const at = src.indexOf('export const actions');
      if (count(at < 0 ? src : src.slice(0, at), /superValidate\s*[<(]/g) >= 2) dirs.add(dir);
    } else if (f.endsWith('/+page.svelte')) {
      if (count(read(f), /\bsuperForm\s*[<(]/g) >= 2) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

export function guardedDirs(files: string[], read: (p: string) => string = (p) => readFileSync(p, 'utf8')): Set<string> {
  return new Set(
    files
      .filter((f) => f.endsWith('.test.ts') && read(f).includes('expectDistinctFormIds('))
      .map((f) => f.slice(0, f.lastIndexOf('/'))),
  );
}

describe('multi-form routes are guarded (#1320)', () => {
  const files = walk(ROUTES);

  it('finds the multi-form routes (a sweep that finds none would pass vacuously)', () => {
    expect(multiFormDirs(files).length).toBeGreaterThanOrEqual(15);
  });

  it('has expectDistinctFormIds beside every one of them', () => {
    const guarded = guardedDirs(files);
    const missing = multiFormDirs(files)
      .filter((d) => !guarded.has(d))
      .map((d) => relative(process.cwd(), d));
    expect(missing, 'multi-form routes whose loader is not pinned with expectDistinctFormIds').toEqual([]);
  });

  it('flags a multi-form route that has no guard (the sweep can fail)', () => {
    const fake = {
      '/r/a/+page.server.ts': 'const x = superValidate(a, b); const y = superValidate(c, d);\nexport const actions = {};',
      '/r/b/+page.server.ts': 'const x = superValidate(a, b);\nexport const actions = { go: superValidate(c, d) };',
      '/r/c/+page.svelte': 'superForm(a); superForm<T>(b);',
      '/r/c/page.test.ts': 'expectDistinctFormIds(x);',
    } as Record<string, string>;
    const names = Object.keys(fake);
    const read = (p: string) => fake[p]!;
    expect(multiFormDirs(names, read)).toEqual(['/r/a', '/r/c']);
    expect([...guardedDirs(names, read)]).toEqual(['/r/c']);
  });
});
