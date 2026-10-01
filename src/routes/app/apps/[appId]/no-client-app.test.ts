/**
 * #990: hadron-client is retired. The App page's setup download must never
 * again point an agent at the client app (localhost:3200, its hooks) or tell
 * the reader to install it. The zip is generated inline in the page, behind a
 * key-creating action, so this pins the SOURCE: with comments stripped, none
 * of the retired product's markers may remain.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');
// Drop // line comments, /* */ blocks and <!-- --> so an explanatory comment
// naming the retired product doesn't trip the guard.
const code = source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('App page setup has no retired hadron-client mode (#990)', () => {
  it('the comment-stripped source is not empty (the guard reads the real file)', () => {
    expect(code.length).toBeGreaterThan(10_000);
    expect(code).toContain('generateAndDownloadZip');
  });

  for (const marker of ['localhost:3200', 'hadron-client', 'HADRON_CLIENT', 'clientMode', 'With Client App', '/hooks/session-start']) {
    it(`contains no "${marker}"`, () => {
      expect(code).not.toContain(marker);
    });
  }
});
