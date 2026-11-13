// AgentChat switches panes on its OWN width (`@container` on its root, `@2xl:`
// variants), because on the App page the app nav takes ~220px from `sm` up and
// a viewport breakpoint can't see it (portal#2088, PR #2090). These pins keep
// that true as the component grows:
//  - no viewport breakpoint variant (sm:/md:/lg:/xl:/2xl:) anywhere in the
//    source of AgentChat or of any module it imports from src/lib: one would
//    fire on the window while the chat is phone-sized;
//  - nothing inside the size container is position:fixed: a size container is
//    the containing block for fixed descendants, so an overlay there would
//    anchor to and clip at the panel (the delete dialog is the root's sibling);
//  - AgentChat mounts only under src/routes/app/, i.e. inside the app layout
//    the Chromium oracle reproduces.
// Every scan errs loud: prose that looks like a variant or `fixed` fails the
// test rather than hiding a real one. The computed-style twin of the `fixed`
// pin, including an opened overlay, runs in
// scripts/test-agent-chat-phone-layout.mjs at every width.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = resolve(ROOT, 'src');
const LIB = resolve(SRC, 'lib');
const AGENT_CHAT = resolve(LIB, 'components/AgentChat.svelte');
const SOURCE = /\.(svelte|ts|js)$/;

const read = (file: string) => readFileSync(file, 'utf8');

/** Every module specifier: static `from`, side-effect `import '…'`, dynamic `import('…')`, either quote. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

/** A specifier resolved to a file under src/, or null for packages and `$app/*`. */
function resolveSpecifier(from: string, raw: string): string | null {
  const spec = raw.replace(/\?.*$/, ''); // `?raw`, `?url`: the file is the path
  const base = spec.startsWith('$lib/')
    ? resolve(LIB, spec.slice(5))
    : spec.startsWith('./') || spec.startsWith('../')
      ? resolve(dirname(from), spec)
      : null;
  // SvelteKit generates `./$types` at build time; it is types only.
  if (!base || /\/\$types$/.test(spec)) return null;
  const candidates = [base, `${base}.ts`, `${base}.js`, base.replace(/\.js$/, '.ts'), join(base, 'index.ts'), join(base, 'index.js')];
  const hit = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  // A specifier into src/ that resolves to nothing would end the walk silently.
  if (!hit) throw new Error(`${relative(ROOT, from)}: cannot resolve '${spec}'`);
  return hit;
}

const importsOf = (file: string) =>
  [...read(file).matchAll(SPECIFIER)].map((m) => resolveSpecifier(file, m[2])).filter((f): f is string => f !== null);

/** AgentChat plus every src/lib module it imports, transitively (components, helpers, barrels). */
function importedModules(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const dep of importsOf(file)) if (dep.startsWith(LIB + '/')) walk(dep);
  };
  walk(entry);
  return [...seen];
}

// A Tailwind viewport variant: `sm:` etc. at a class-token start. `@2xl:` (a
// container variant) is excluded by the preceding-character class.
const VIEWPORT_VARIANT = /(?<![\w@-])(?:max-)?(?:sm|md|lg|xl|2xl):[\w[]/g;
// The `fixed` utility as a token, and `position: fixed` / `.position = 'fixed'`.
const FIXED = /(?<![\w-])fixed(?![\w-])|position\s*[:=]\s*['"`]?\s*fixed/g;
const hits = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[0]);
/**
 * Source minus whole comments (HTML, block, and line comments on their own
 * line), which never render. A trailing comment after code stays and fails loud.
 */
const uncommented = (source: string) =>
  source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

type Node = { type: string; name?: string; start: number; end: number; attributes?: Node[]; value?: unknown; fragment?: { nodes: Node[] } };

/** The literal text of a parsed element's static `class` attribute. */
function staticClass(el: Node, source: string): string {
  const attr = el.attributes?.find((a) => a.type === 'Attribute' && a.name === 'class');
  return attr ? source.slice(attr.start, attr.end) : '';
}

describe('AgentChat breakpoints are the container’s, not the viewport’s (portal#2088)', () => {
  const modules = importedModules(AGENT_CHAT);
  const rel = (f: string) => relative(LIB, f);

  it('walks every import form', () => {
    const specs = (s: string) => [...s.matchAll(SPECIFIER)].map((m) => m[2]);
    expect(
      specs(`import A from '$lib/a.svelte';\nimport B from "./b.svelte";\nexport { C } from '../c';\nconst D = import("$lib/d.ts");\nimport './e.css';\nimport type { F } from '$lib/f';`),
    ).toEqual(['$lib/a.svelte', './b.svelte', '../c', '$lib/d.ts', './e.css', '$lib/f']);
    expect(modules.map(rel)).toEqual(
      expect.arrayContaining(['components/AgentChat.svelte', 'components/ServedPrompt.svelte', 'components/Urn.svelte', 'components/agent-chat-helpers.ts']),
    );
  });

  it('the patterns catch what they guard and skip container variants', () => {
    expect(hits(VIEWPORT_VARIANT, `class="flex sm:hidden md:w-64 max-sm:p-2 lg:[x]" const c = open ? 'xl:block' : ''`)).toEqual([
      'sm:h',
      'md:w',
      'max-sm:p',
      'lg:[',
      'xl:b',
    ]);
    expect(hits(VIEWPORT_VARIANT, 'class="@container hidden @2xl:flex @sm:p-1 focus:outline-none dark:bg-zinc-900"')).toEqual([]);
    expect(hits(FIXED, `class="fixed inset-0" el.style.position = 'fixed'; style="position: fixed"`)).toHaveLength(3);
    expect(hits(FIXED, 'class="fixed-width prefixed affixed"')).toEqual([]);
    expect(hits(FIXED, uncommented(`/** the route's fixed message */\n  // a fixed note\n  const c = 'fixed'; // fixed`))).toEqual(['fixed', 'fixed']);
  });

  // Full source, script included: a class string built in script renders too.
  it.each(modules.map((f) => [rel(f), f]))('%s has no viewport breakpoint variant', (_name, file) => {
    expect(hits(VIEWPORT_VARIANT, read(file))).toEqual([]);
  });

  it('the root is the size container and nothing inside it is position:fixed', () => {
    const source = read(AGENT_CHAT);
    const ast = parse(source, { modern: true }) as unknown as { fragment: { nodes: Node[] }; instance?: Node };
    const top = ast.fragment.nodes.filter((n) => n.type === 'RegularElement');
    const roots = top.filter((n) => /(?<![\w-])@container(?![\w-])/.test(staticClass(n, source)));
    expect(roots, 'AgentChat root lost @container').toHaveLength(1);
    const [root] = roots;
    // The parser's own subtree bounds, whatever the formatting.
    expect(hits(FIXED, source.slice(root.start, root.end))).toEqual([]);
    // The script can build classes or set styles on elements inside the root.
    if (ast.instance) expect(hits(FIXED, uncommented(source.slice(ast.instance.start, ast.instance.end)))).toEqual([]);
    // The delete dialog is still there, outside the root.
    expect(hits(FIXED, source.slice(root.end)).length).toBeGreaterThan(0);
    for (const file of modules.filter((f) => f !== AGENT_CHAT)) {
      expect(hits(FIXED, uncommented(read(file))), rel(file)).toEqual([]);
    }
  });

  it('mounts only inside the app layout (src/routes/app/)', () => {
    // Source files that reach AgentChat through any import form, transitively,
    // so a src/lib wrapper or barrel counts by where IT is mounted. Tests and
    // the test harness mount it on purpose.
    const sources = filesUnder(SRC).filter((f) => SOURCE.test(f) && !/\.test\.ts$/.test(f) && !f.startsWith(resolve(LIB, 'test') + '/'));
    const deps = new Map(sources.map((f) => [f, importsOf(f)]));
    const reaching = new Set([AGENT_CHAT]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [f, imports] of deps) {
        if (!reaching.has(f) && imports.some((d) => reaching.has(d))) {
          reaching.add(f);
          grew = true;
        }
      }
    }
    const routes = [...reaching].filter((f) => f.startsWith(resolve(SRC, 'routes') + '/')).map((f) => relative(ROOT, f));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((f) => !f.startsWith('src/routes/app/'))).toEqual([]);
    expect([...reaching].filter((f) => !f.startsWith(SRC + '/')).map((f) => relative(ROOT, f))).toEqual([]);
  });
});
