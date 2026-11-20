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
 * Specifiers are read with TypeScript's own import pre-processor
 * (`ts.preProcessFile`), which tokenizes the source: it sees static
 * `import … from`, `export … from`, side-effect imports, `import type`,
 * literal dynamic `import()` and `require()`, including with comments between
 * tokens, and it ignores comments, strings and template literals that merely
 * mention an import. A `.svelte` file is scanned through the instance and
 * module scripts that Svelte's own parser (`svelte/compiler` `parse`) finds, so
 * a `<script>` inside an HTML comment or markup text is not code and is not read;
 * a component that fails to parse fails this test loudly rather than being skipped.
 *
 * Limits: a specifier assembled at runtime is not seen, and only the `.test`
 * naming is recognized (the repo has no `.spec` or `__tests__` convention).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '../../..');
const SCANNED = ['src', 'scripts'];
const SOURCE = /\.(ts|js|mjs|cjs|svelte)$/;
// `foo.test`, `foo.client.test`, `foo.test.ts`, `foo.client.test.js`, …
const TEST_MODULE = /\.test(\.(ts|js|mjs|cjs))?$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The text of a component's module and instance scripts, as the Svelte parser finds them. */
function svelteScripts(src: string): string {
  const ast = parse(src, { modern: true });
  return [ast.module, ast.instance]
    .filter((s) => s != null)
    // The parser sets source offsets on `content`; ESTree's Program type omits them.
    .map((s) => s.content as unknown as { start: number; end: number })
    .map((c) => src.slice(c.start, c.end))
    .join('\n;\n');
}

/** Every import specifier in `src` (a `.svelte` file is read through its scripts) that names a test module. */
function testModuleImports(src: string, svelte = false): string[] {
  const code = svelte ? svelteScripts(src) : src;
  return ts
    .preProcessFile(code, true, true)
    .importedFiles.map((f) => f.fileName)
    .filter((s) => TEST_MODULE.test(s));
}

/** `file -> specifier` for every test-module import in `files`. */
function offendersIn(files: string[], read: (p: string) => string): string[] {
  return files.flatMap((f) =>
    testModuleImports(read(f), f.endsWith('.svelte')).map((s) => `${relative(ROOT, f)} -> ${s}`),
  );
}

describe('no module imports a test module (portal#1573)', () => {
  // portal#2347: this one it() parses every source file under src/ and
  // scripts/ (~1400 files) through ts.preProcessFile and the Svelte parser —
  // about 2s idle but ~5s on a loaded runner, over vitest's 5000ms default
  // and the reason three PRs' ci reran on a timeout that never failed on
  // content. The scan's own budget is raised here, not the suite's, so a
  // genuinely hung test elsewhere still trips the default.
  it('finds none under src/ or scripts/', { timeout: 30_000 }, () => {
    const files = SCANNED.map((d) => join(ROOT, d))
      .filter(existsSync)
      .flatMap(walk)
      .filter((f) => SOURCE.test(f) && f !== SELF);
    // Non-vacuous: the scan reaches the two files #1573 was about (a
    // `.client.test.ts` under a bracketed route directory among them).
    const rel = new Set(files.map((f) => relative(ROOT, f).split('\\').join('/')));
    expect(rel.has('src/lib/components/agent-tasks/TaskEditFields.client.test.ts')).toBe(true);
    expect(rel.has('src/routes/app/apps/[appId]/tasks/new/page.client.test.ts')).toBe(true);
    expect(offendersIn(files, (p) => readFileSync(p, 'utf8'))).toEqual([]);
  });

  it('flags every import form that names a test module', () => {
    expect(testModuleImports(`import { A } from '$lib/x/Y.client.test';`)).toEqual(['$lib/x/Y.client.test']);
    expect(testModuleImports(`import { A } from /* shared */ '$lib/x/Y.client.test';`)).toEqual(['$lib/x/Y.client.test']);
    expect(testModuleImports(`import { A } from "./y.test.ts";`)).toEqual(['./y.test.ts']);
    expect(testModuleImports(`import type { T } from './y.test';`)).toEqual(['./y.test']);
    expect(testModuleImports(`export { A } from './y.test';`)).toEqual(['./y.test']);
    expect(testModuleImports(`import './y.client.test.js';`)).toEqual(['./y.client.test.js']);
    expect(testModuleImports(`const m = await import(/* lazy */ './y.test');`)).toEqual(['./y.test']);
    expect(testModuleImports(`const m = require('./y.test');`)).toEqual(['./y.test']);
    expect(testModuleImports(`<script lang="ts">\n  import { A } from './y.test';\n</script>\n<p>{A}</p>`, true)).toEqual(['./y.test']);
    expect(testModuleImports(`<script module>import './m.test';</script>\n<script>import './i.test';</script>`, true)).toEqual(['./m.test', './i.test']);
  });

  it('leaves non-test modules and mere mentions alone', () => {
    expect(testModuleImports(`import { describe } from 'vitest';`)).toEqual([]);
    expect(testModuleImports(`import { mountComponent } from '$lib/test/mountComponent';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './testing';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './latest';`)).toEqual([]);
    expect(testModuleImports(`import { x } from './contest.ts';`)).toEqual([]);
    expect(testModuleImports(`// Do not write: import './example.test';\nexport const probe = 1;`)).toEqual([]);
    expect(testModuleImports(`/* import { A } from './y.test'; */`)).toEqual([]);
    expect(testModuleImports(`const s = "import { A } from './y.test'";`)).toEqual([]);
    expect(testModuleImports('const t = `import "./y.test"`;')).toEqual([]);
    expect(testModuleImports(`<p>Never import './y.test' here.</p>`, true)).toEqual([]);
    // George's delta probe at 652dc3a4: a script inside an HTML comment is prose.
    expect(testModuleImports(`<!-- Example only: <script>import "./example.test";</script> --><p>Documentation only</p>`, true)).toEqual([]);
  });

  it('reports each offending file by its path under the root', () => {
    const files = [join(ROOT, 'src/a.client.test.ts'), join(ROOT, 'src/B.svelte'), join(ROOT, 'src/c.ts')];
    const body: Record<string, string> = {
      [files[0]]: `import { X } from /* c */ './b.client.test';`,
      [files[1]]: `<script>import './d.test';</script>`,
      [files[2]]: `// import './e.test'`,
    };
    expect(offendersIn(files, (p) => body[p])).toEqual([
      `${join('src', 'a.client.test.ts')} -> ./b.client.test`,
      `${join('src', 'B.svelte')} -> ./d.test`,
    ]);
  });
});
