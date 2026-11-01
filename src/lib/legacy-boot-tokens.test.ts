/**
 * portal#1376 — the bare boot-prompt tokens (double-braced `name` and `role`) stopped
 * binding with hadron-server#2894; the closed set is `{{worker.name}}`,
 * `{{worker.role}}` and the other platform variables
 * (hrn:node:hadronmemory.com:specs:cor:dmo:150:08). Portal comments and
 * fixtures show authors what to write, so none may model the retired form.
 * `schema/` is out of scope: its one mention is the server's own SDL text
 * describing the retired tokens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
// Built from parts so this file does not match itself.
const BRACE = '\\{\\{';
const LEGACY = new RegExp(`${BRACE}\\s*(?:name|role)\\s*\\}\\}`);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|js|svelte|graphql|md|json)$/.test(entry.name)) yield path;
  }
}

describe('legacy boot-prompt tokens (#1376)', () => {
  it('the pattern catches the retired tokens and spares the closed set', () => {
    expect(LEGACY.test('You are {{' + 'name}}, a {{' + 'role}}.')).toBe(true);
    expect(LEGACY.test('{{ ' + 'role }}')).toBe(true);
    expect(LEGACY.test('You are {{worker.name}}, a {{worker.role}}.')).toBe(false);
    expect(LEGACY.test('{{agent.name}} {{session.llmModel}}')).toBe(false);
  });

  it('no file under src/ names a bare double-braced name or role token', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (LEGACY.test(line)) hits.push(`${relative(process.cwd(), file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
