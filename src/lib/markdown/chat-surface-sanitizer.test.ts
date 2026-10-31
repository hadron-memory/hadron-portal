/**
 * #1512: every surface that feeds `renderChatMarkdown` output to `{@html}` must
 * pass it through `DOMPurify.sanitize` first. `renderChatMarkdown` is NOT
 * sanitized (marked passes raw HTML through), so dropping the sanitizer at a
 * call site is stored XSS, and no behavioural test noticed (Portal Invariant P4,
 * hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
 *
 * The surfaces do not converge on one path — each component owns its own
 * `renderMarkdown` — so this reads the source of every file that calls the
 * renderer and fails unless each call is either wrapped directly in
 * `DOMPurify.sanitize(...)` or assigned to a const whose only use is as the
 * argument of `DOMPurify.sanitize(...)`. Anything else must be reviewed by
 * hand, so the guard refuses it rather than guessing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** Empty when every `renderChatMarkdown(` call in `source` is sanitized. */
export function unsanitizedCalls(source: string): string[] {
  const problems: string[] = [];
  const re = /renderChatMarkdown\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const before = source.slice(0, m.index);
    if (/DOMPurify\.sanitize\(\s*$/.test(before)) continue;
    const assigned = /(?:const|let)\s+(\w+)\s*=\s*$/.exec(before);
    if (assigned) {
      const name = assigned[1];
      const uses = [...source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
      const sanitized = [...source.matchAll(new RegExp(`DOMPurify\\.sanitize\\(\\s*${name}\\s*\\)`, 'g'))].length;
      // one declaration + one use, and that use is the sanitizer's argument
      if (uses === 2 && sanitized === 1) continue;
    }
    const line = before.split('\n').length;
    problems.push(`line ${line}: renderChatMarkdown output is not passed straight to DOMPurify.sanitize`);
  }
  return problems;
}

describe('chat surfaces sanitize renderChatMarkdown (#1512)', () => {
  const surfaces = walk(SRC)
    .filter((f) => !f.endsWith('.test.ts') && /\brenderChatMarkdown\(/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).split('\\').join('/'))
    .sort();

  it('covers exactly the known surfaces (a new one must be added here on purpose)', () => {
    expect(surfaces).toEqual([...EXPECTED_SURFACES].sort());
  });

  it.each(EXPECTED_SURFACES)('%s sanitizes every call', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');
    expect(source).toMatch(/import DOMPurify from 'dompurify'/);
    expect(unsanitizedCalls(source)).toEqual([]);
  });

  describe('the guard itself (mutants)', () => {
    it('accepts the direct and the assigned-then-sanitized forms', () => {
      expect(unsanitizedCalls('return DOMPurify.sanitize(renderChatMarkdown(t));')).toEqual([]);
      expect(unsanitizedCalls('const raw = renderChatMarkdown(t);\nreturn DOMPurify.sanitize(raw);')).toEqual([]);
    });
    it('rejects a call with the sanitizer dropped', () => {
      expect(unsanitizedCalls('return renderChatMarkdown(t);')).toHaveLength(1);
      expect(unsanitizedCalls('const raw = renderChatMarkdown(t);\nreturn raw;')).toHaveLength(1);
    });
    it('rejects an assigned result that is also used unsanitized', () => {
      expect(
        unsanitizedCalls('const raw = renderChatMarkdown(t);\nlog(raw);\nreturn DOMPurify.sanitize(raw);'),
      ).toHaveLength(1);
    });
  });
});
