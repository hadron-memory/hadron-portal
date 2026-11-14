import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const haveChromium = existsSync(chromium.executablePath());
// Exercise the actual entrypoint: a new collector/guard that is never called
// cannot pass by testing a disconnected copy of its assertions.
describe.skipIf(!haveChromium)('chat row oracle native failure controls (#2176)', { timeout: 180_000 }, () => {
  it.each([
    ['missing-meta-free', '640/light: chats:a meta free space is missing or hidden'],
    ['hidden-meta-text', '640/light: chats:a meta text is missing or hidden'],
    ['delayed-resume', '640/light: chats:a meta text settled resume count'],
    ['rename-overlay', '640/light: rename input pointer opened the chat'],
  ])('%s fails by its named assertion', (control, diagnostic) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CHAT_ROW_CONTROL', 'AGENT_CHAT_SHOTS'].includes(k)));
    const r = spawnSync('node', ['scripts/test-agent-chat-row-actions.mjs'], {
      env: { ...env, CHAT_ROW_CONTROL: control }, encoding: 'utf8', timeout: 150_000,
    });
    expect(r.error, 'entrypoint must complete, not time out or fail to spawn').toBeUndefined();
    const output = `${r.stdout}\n${r.stderr}`;
    expect(output).toContain(`CONTROL ACTIVE: ${control}`);
    expect(r.status).not.toBe(0);
    expect(output).toContain(diagnostic);
    expect(output).not.toContain('TypeError:');
  });
});
