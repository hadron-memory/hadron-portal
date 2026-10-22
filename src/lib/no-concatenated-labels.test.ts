import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * portal#1197 — a translated fragment must not be concatenated with a row's
 * name (`${t('x.actions.label', 'Actions for')} ${row.name}`). That fixes
 * English word order, so a locale needing a suffix or another order cannot be
 * expressed. The label takes a placeholder instead:
 * `t('x.actions.label', 'Actions for {name}', { name: row.name })`.
 * A source-level pin: every site renders identically in English, so no
 * behavioural test can tell the two forms apart.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const CONCATENATED = /`\$\{t\(\s*'[^']*actions\.label'[^`]*`/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.svelte') && path !== SELF ? [path] : [];
  });
}

describe('⋯-menu aria-labels interpolate the name (portal#1197)', () => {
  it('finds the source tree', () => {
    expect(sources(SRC).length).toBeGreaterThan(100);
  });

  it('concatenates no translated fragment with a name', () => {
    const hits = sources(SRC).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, i) => (CONCATENATED.test(line) ? [`${relative(SRC, path)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
