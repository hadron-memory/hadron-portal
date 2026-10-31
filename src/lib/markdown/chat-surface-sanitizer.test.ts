/**
 * #1512: every surface that feeds `renderChatMarkdown` output to `{@html}` must
 * pass it through `DOMPurify.sanitize` first. `renderChatMarkdown` is NOT
 * sanitized (marked passes raw HTML through), so dropping the sanitizer at a
 * call site is stored XSS, and no behavioural test noticed (Portal Invariant P4,
 * hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
 *
 * The surfaces do not converge on one path — each component owns its own
 * `renderMarkdown` — so this parses every file that imports the renderer (the
 * Svelte AST, so comments and whitespace cannot move the verdict, and an aliased
 * import is still followed) and fails unless each use is either a call that is
 * the first argument of the file's own `DOMPurify.sanitize(...)`, or a call
 * assigned to a const whose single use is that argument. Anything else (a call
 * inside a larger expression, the function passed around uncalled, a namespace
 * import) must be reviewed by hand, so the guard refuses it rather than guess.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');

/** The seven chat / comment / briefing / agent-chat surfaces of #1493. */
const EXPECTED_SURFACES = [
  'lib/components/AgentChat.svelte',
  'lib/components/ChatThread.svelte',
  'lib/components/NodeDiscussion.svelte',
  'lib/components/TeamChatThread.svelte',
  'lib/components/agent-tester/PersonaScript.svelte',
  'routes/app/agents/[id]/test/+page.svelte',
  'routes/app/workers/[id]/+page.svelte',
];

const RENDERER_PATH = /markdown\/chat-markdown['"]/;

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.svelte')) out.push(p);
  }
  return out;
}

type Node = { type: string; [k: string]: unknown };
const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';

/** Depth-first over every AST node in the file, script and markup alike. */
function walk(root: unknown, visit: (n: Node, parent: Node | null) => void) {
  const seen = new WeakSet<object>();
  const go = (v: unknown, parent: Node | null) => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach((x) => go(x, parent));
    const node = isNode(v) ? v : null;
    if (node) visit(node, parent);
    for (const [k, child] of Object.entries(v)) {
      if (k === 'loc' || k === 'metadata') continue;
      go(child, node ?? parent);
    }
  };
  go(root, null);
}

/** Empty when every use of the renderer in `source` is sanitized. */
export function unsanitizedUses(source: string): string[] {
  const ast = parse(source, { modern: true }) as unknown;
  const problems: string[] = [];
  const rendererNames = new Set<string>();
  let purify: string | null = null;

  walk(ast, (n) => {
    if (n.type !== 'ImportDeclaration') return;
    const from = (n.source as { value: string }).value;
    for (const s of n.specifiers as Node[]) {
      const local = (s.local as { name: string }).name;
      if (from === 'dompurify' && s.type === 'ImportDefaultSpecifier') purify = local;
      if (RENDERER_PATH.test(`${from}'`)) {
        if (s.type === 'ImportSpecifier' && (s.imported as { name: string }).name === 'renderChatMarkdown') {
          rendererNames.add(local);
        } else {
          problems.push(`unsupported import of the chat renderer (${s.type} ${local})`);
        }
      }
    }
  });
  if (rendererNames.size === 0 && problems.length === 0) return ['no renderChatMarkdown import found'];

  const isSanitizeCallWith = (parent: Node | null, arg: Node): boolean => {
    if (!parent || parent.type !== 'CallExpression' || !purify) return false;
    const callee = parent.callee as Node;
    return (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      (callee.object as Node).type === 'Identifier' &&
      (callee.object as { name: string }).name === purify &&
      (callee.property as { name: string }).name === 'sanitize' &&
      // exactly one argument: a second one is a config that can weaken the sanitizer
      (parent.arguments as Node[]).length === 1 &&
      (parent.arguments as Node[])[0] === arg
    );
  };

  // Gather every Identifier with its parent, once.
  const refs: { id: Node; parent: Node | null }[] = [];
  walk(ast, (n, parent) => {
    if (n.type === 'Identifier' && parent?.type !== 'ImportSpecifier') refs.push({ id: n, parent });
  });
  const named = (name: string) => refs.filter((r) => (r.id as unknown as { name: string }).name === name);

  const parents = new Map<Node, Node | null>();
  walk(ast, (n, parent) => parents.set(n, parent));

  for (const name of rendererNames) {
    for (const { id, parent } of named(name)) {
      if (!parent || parent.type !== 'CallExpression' || parent.callee !== id) {
        problems.push(`${name} is referenced without being called directly`);
        continue;
      }
      const up = parents.get(parent) ?? null;
      if (isSanitizeCallWith(up, parent)) continue;
      if (up?.type === 'VariableDeclarator' && up.init === parent && (up.id as Node).type === 'Identifier') {
        const holder = (up.id as { name: string }).name;
        const uses = named(holder).filter((r) => r.id !== up.id);
        if (uses.length === 1 && isSanitizeCallWith(uses[0].parent, uses[0].id)) continue;
        problems.push(`${holder} (a ${name} result) is used other than as DOMPurify.sanitize's argument`);
        continue;
      }
      problems.push(`a ${name}(...) call is not passed straight to DOMPurify.sanitize`);
    }
  }
  return problems;
}

const wrap = (script: string, markup = '') => `<script lang="ts">\n${script}\n</script>\n${markup}`;
const IMPORTS = `import DOMPurify from 'dompurify';\nimport { renderChatMarkdown } from '$lib/markdown/chat-markdown';`;

describe('chat surfaces sanitize renderChatMarkdown (#1512)', () => {
  const surfaces = walkFiles(SRC)
    .filter((f) => RENDERER_PATH.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).split('\\').join('/'))
    .sort();

  it('covers exactly the known surfaces (a new one must be added here on purpose)', () => {
    expect(surfaces).toEqual([...EXPECTED_SURFACES].sort());
  });

  it('no non-Svelte module imports the renderer except its own tests (the AST guard reads .svelte only)', () => {
    const importers: string[] = [];
    const walkTs = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walkTs(p);
        else if (/\.(ts|js)$/.test(p) && !/\.test\.ts$/.test(p) && RENDERER_PATH.test(readFileSync(p, 'utf8'))) {
          importers.push(relative(SRC, p).split('\\').join('/'));
        }
      }
    };
    walkTs(SRC);
    expect(importers).toEqual([]);
  });

  it.each(EXPECTED_SURFACES)('%s sanitizes every use', (file) => {
    expect(unsanitizedUses(readFileSync(join(SRC, file), 'utf8'))).toEqual([]);
  });

  describe('the guard itself (mutants)', () => {
    it('accepts the direct and the assigned-then-sanitized forms', () => {
      expect(unsanitizedUses(wrap(`${IMPORTS}\nconst f = (t) => DOMPurify.sanitize(renderChatMarkdown(t));`))).toEqual([]);
      expect(
        unsanitizedUses(wrap(`${IMPORTS}\nfunction f(t){ const raw = renderChatMarkdown(t);\nreturn DOMPurify.sanitize(raw); }`)),
      ).toEqual([]);
    });

    it.each([
      ['sanitizer dropped', 'const f = (t) => renderChatMarkdown(t);'],
      ['assigned and returned raw', 'function f(t){ const raw = renderChatMarkdown(t); return raw; }'],
      ['assigned, also used raw', 'function f(t){ const raw = renderChatMarkdown(t); log(raw); return DOMPurify.sanitize(raw); }'],
      ['space before the paren', 'const f = (t) => renderChatMarkdown (t);'],
      ['newline before the paren', 'const f = (t) => renderChatMarkdown\n(t);'],
      ['comment spoofs the wrapper', 'function f(t){ const raw = renderChatMarkdown(t); return raw; // DOMPurify.sanitize(raw)\n}'],
      ['block comment spoofs the wrapper', 'const f = (t) => /* DOMPurify.sanitize( */ renderChatMarkdown(t);'],
      ['concatenated before sanitizing', 'function f(t){ const raw = renderChatMarkdown(t) + evil; return DOMPurify.sanitize(raw); }'],
      ['concatenated inside the wrapper', 'const f = (t) => DOMPurify.sanitize(renderChatMarkdown(t) + evil);'],
      ['sanitized call plus a raw one', 'const f = (t) => DOMPurify.sanitize(renderChatMarkdown(t)) + renderChatMarkdown(t);'],
      ['function passed around uncalled', 'const g = renderChatMarkdown; const f = (t) => g(t);'],
      ['indirect call hides the callee', 'const f = (t) => DOMPurify.sanitize((0, renderChatMarkdown)(t));'],
      ['sanitizer given a weakening config', 'const f = (t) => DOMPurify.sanitize(renderChatMarkdown(t), { FORBID_TAGS: [] });'],
      ['the wrapper is not the sanitizer', 'const f = (t) => notPurify.sanitize(renderChatMarkdown(t));'],
    ])('rejects: %s', (_n, body) => {
      expect(unsanitizedUses(wrap(`${IMPORTS}\n${body}`)).length).toBeGreaterThan(0);
    });

    it('follows an aliased import', () => {
      const aliased = `import DOMPurify from 'dompurify';\nimport { renderChatMarkdown as md } from '$lib/markdown/chat-markdown';`;
      expect(unsanitizedUses(wrap(`${aliased}\nconst f = (t) => md(t);`)).length).toBeGreaterThan(0);
      expect(unsanitizedUses(wrap(`${aliased}\nconst f = (t) => DOMPurify.sanitize(md(t));`))).toEqual([]);
    });

    it('follows an aliased sanitizer import and refuses a missing one', () => {
      const alias = `import P from 'dompurify';\nimport { renderChatMarkdown } from '$lib/markdown/chat-markdown';`;
      expect(unsanitizedUses(wrap(`${alias}\nconst f = (t) => P.sanitize(renderChatMarkdown(t));`))).toEqual([]);
      const none = `import { renderChatMarkdown } from '$lib/markdown/chat-markdown';`;
      expect(unsanitizedUses(wrap(`${none}\nconst f = (t) => renderChatMarkdown(t);`)).length).toBeGreaterThan(0);
    });

    it('refuses a namespace or default import it cannot follow', () => {
      const ns = `import DOMPurify from 'dompurify';\nimport * as cm from '$lib/markdown/chat-markdown';`;
      expect(unsanitizedUses(wrap(`${ns}\nconst f = (t) => DOMPurify.sanitize(cm.renderChatMarkdown(t));`)).length).toBeGreaterThan(0);
    });

    it('sees a call written in the markup', () => {
      expect(unsanitizedUses(wrap(IMPORTS, '{@html renderChatMarkdown(text)}')).length).toBeGreaterThan(0);
      expect(unsanitizedUses(wrap(IMPORTS, '{@html DOMPurify.sanitize(renderChatMarkdown(text))}'))).toEqual([]);
    });
  });
});
