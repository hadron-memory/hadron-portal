/**
 * portal#1573 — no module imports a test module.
 *
 * Importing a `*.test.ts` file registers its `describe` blocks inside the
 * importing file's run too, so the imported file's cases execute twice: once
 * in their own file and once in the importer's. The create page's test did
 * exactly that to borrow `MIN_TIER_HELP` from the Edit panel's test, which
 * inflated the counts and blurred which file a failure belongs to. Shared test
 * literals and helpers belong in a non-test module under `src/lib/test/`.
 *
 * Limit: this is a lexical backstop. It reads static `import … from`,
 * `export … from`, side-effect `import '…'` and literal dynamic `import('…')`
 * specifiers; a specifier assembled at runtime is not seen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCANNED = ['src', 'scripts'];
const SOURCE = /\.(ts|js|mjs|cjs|svelte)$/;
// This file's own fixtures below are specifiers on purpose.
const SELF = 'src/lib/test/no-test-module-imports.test.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
// `foo.test`, `foo.client.test`, `foo.test.ts`, `foo.client.test.js`, …
const TEST_MODULE = /\.test(\.(ts|js|mjs|cjs))?$/;

/** Every specifier in `src` that names a test module. */
function testModuleImports(src: string): string[] {
  return [...src.matchAll(SPECIFIER)].map((m) => m[2]).filter((s) => TEST_MODULE.test(s));
}

describe('no module imports a test module (portal#1573)', () => {
  it('finds none under src/ or scripts/', () => {
    const offenders = SCANNED.flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => SOURCE.test(f) && relative(ROOT, f) !== SELF)
      .flatMap((f) => testModuleImports(readFileSync(f, 'utf8')).map((s) => `${relative(ROOT, f)} -> ${s}`));
    expect(offenders).toEqual([]);
  });

  it('flags every import form that names a test module', () => {
    expect(testModuleImports(`import { A } from '$lib/x/Y.client.test';`)).toEqual(['$lib/x/Y.client.test']);
    expect(testModuleImports(`import { A } from "./y.test.ts";`)).toEqual(['./y.test.ts']);
    expect(testModuleImports(`export { A } from './y.test';`)).toEqual(['./y.test']);
    expect(testModuleImports(`import './y.client.test.js';`)).toEqual(['./y.client.test.js']);
    expect(testModuleImports(`const m = await import('./y.test');`)).toEqual(['./y.test']);
  });

  it('leaves non-test modules alone', () => {
    expect(testModuleImports(`import { describe } from 'vitest';`)).toEqual([]);
    expect(testModuleImports(`import { mountComponent } from '$lib/test/mountComponent';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './testing';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './latest';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './contest.ts';`)).toEqual([]);
  });
});
