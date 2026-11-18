import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * portal#1197 — a ⋯ row-menu's aria-label interpolates the row's name through
 * t(id, defaultText, vars); it is never built by concatenating a translated
 * fragment with the raw value. In English the two forms render the same bytes,
 * so no behavioural test can tell them apart (the same situation as
 * skill-export.i18n.test.ts) — what differs is the contract: only the
 * placeholder form lets a future locale choose its own word order.
 *
 * A source-level pin over the #1020 menu-label family (`*.actions.label`),
 * the same approach as no-webauthn.test.ts: a new concatenation would pass
 * every behavioural test and quietly take the string back out of the
 * translator's hands.
 */
const SRC = fileURLToPath(new URL('../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** `…${t('….actions.label', '…')} ${value}…` — the translated fragment and the value joined outside t(). */
const CONCATENATED = /\$\{\s*t\(\s*'[^']*actions\.label'[^}]*\)\}[^$]*\$\{/;
/** `t('….actions.label', '…{placeholder}…', { … })` — the placeholder form, vars crossing the boundary. */
const INTERPOLATED = /t\(\s*'[^']*actions\.label'\s*,\s*'[^']*\{\w+\}[^']*'\s*,/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(svelte|ts|js)$/.test(name) && path !== SELF ? [path] : [];
  });
}

function hits(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const path of sources(SRC)) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) found.push(`${relative(SRC, path)}:${i + 1}`);
    });
  }
  return found;
}

describe('⋯-menu actions labels interpolate their row name (portal#1197)', () => {
  it('finds the source tree', () => {
    // Guard against a vacuous pass: an empty walk would match nothing.
    expect(sources(SRC).length).toBeGreaterThan(100);
  });

  it('still sees the in-tree placeholder sites the pattern comes from', () => {
    // Guard against a vacuous pass the other way: if the `actions.label` id
    // family is ever renamed, fail here rather than pin an empty family.
    const priorArt = [
    'lib/components/register/RegisterPanel.svelte',
    'lib/components/assets/AssetTable.svelte',
    'routes/app/apps/[appId]/channels/+page.svelte',
    'routes/app/orgs/[id]/runs/+page.svelte',
    ];
    for (const path of priorArt) {
      expect(hits(INTERPOLATED).some((hit) => hit.startsWith(`${path}:`))).toBe(true);
    }
  });

  it('builds no actions.label by concatenating around t()', () => {
    expect(hits(CONCATENATED)).toEqual([]);
  });
});
