/**
 * portal#2099 — no Tester endpoint left out of the manager gate.
 *
 * Every route module under src/routes/api/agent-chat/, plus the Tester page
 * load, that DIRECTLY references the chat symbols (START_CHAT_MUTATION,
 * resolveChatAi or runChatTurn) must either call `requireTesterAgent(` or be on
 * the named allowlist of production chat endpoints. A new unlisted consumer
 * fails.
 *
 * Limits: the scan is textual, so it cannot see a route that starts a chat
 * through a wrapper module that holds those symbols. Paths resolve against
 * `process.cwd()`, so run it from the repository root (as `pnpm test` does).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const API = join(ROOT, 'src/routes/api/agent-chat');
const PAGE = join(ROOT, 'src/routes/app/agents/[id]/test/+page.server.ts');

/** Production (App chat) endpoints: the server's own startChat admission governs them, not the Tester gate. */
export const PRODUCTION_CHAT_ENDPOINTS = [
  'src/routes/api/agent-chat/start/+server.ts',
  'src/routes/api/agent-chat/turn/+server.ts',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Source files only: tests and non-route helpers cannot be endpoints. */
export function chatConsumers(files: string[], read: (p: string) => string = (p) => readFileSync(p, 'utf8')) {
  return files.filter((f) => /(^|[\\/])\+(server|page\.server)\.ts$/.test(f) && /START_CHAT_MUTATION|resolveChatAi|runChatTurn/.test(read(f)));
}

/** A comment that merely names the helper is not a call. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const callsGate = (file: string) => /\brequireTesterAgent\(/.test(stripComments(readFileSync(join(ROOT, file), 'utf8')));

describe('every Tester chat consumer goes through requireTesterAgent', () => {
  // The page never names the chat symbols, so the detector would drop it: keep it in the set explicitly.
  const consumers = [...new Set([...chatConsumers(walk(API).filter((f) => !f.endsWith('.test.ts'))), PAGE])];
  const rel = (p: string) => relative(ROOT, p);

  it('finds the known consumers (the scan is not vacuous)', () => {
    const names = consumers.map(rel);
    for (const n of ['test-run', 'test-persona', 'start']) expect(names.some((x) => x.includes(`/${n}/`))).toBe(true);
  });

  it.each(consumers.map((c) => [rel(c)]))('%s imports requireTesterAgent or is a named production endpoint', (file) => {
    const gated = callsGate(file);
    expect(gated || PRODUCTION_CHAT_ENDPOINTS.includes(file)).toBe(true);
  });

  it('the allowlist names only endpoints that exist and are NOT also gated', () => {
    for (const f of PRODUCTION_CHAT_ENDPOINTS) {
      expect(consumers.map(rel)).toContain(f);
      expect(callsGate(f)).toBe(false);
    }
  });

  it('the Tester page is in the consumer set and calls requireTesterAgent(', () => {
    expect(consumers.map(rel)).toContain(rel(PAGE));
    expect(callsGate(rel(PAGE))).toBe(true);
  });

  it('the fixtures endpoints, which only touch the system memory, are gated too', () => {
    for (const f of ['src/routes/api/agent-chat/fixtures/+server.ts', 'src/routes/api/agent-chat/fixtures/run/+server.ts']) {
      expect(callsGate(f)).toBe(true);
    }
  });

  it('a comment naming the helper is not a call', () => {
    expect(stripComments('// requireTesterAgent(x)\n/* requireTesterAgent( */ const a = 1;')).not.toMatch(/requireTesterAgent\(/);
  });

  it('flags a new unlisted consumer (the detector is not blind)', () => {
    const fake = { 'src/routes/api/agent-chat/new/+server.ts': "import { resolveChatAi } from 'x'" };
    const found = chatConsumers(Object.keys(fake), (p) => fake[p as keyof typeof fake]);
    expect(found).toHaveLength(1);
    expect(PRODUCTION_CHAT_ENDPOINTS.includes(found[0])).toBe(false);
  });
});
