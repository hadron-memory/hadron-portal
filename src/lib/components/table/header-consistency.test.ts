/**
 * #1021 — every grid that draws the saved-views/search/columns header draws it
 * through the one shared TableFrame, so no table can ship its own layout again.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? svelteFiles(p) : p.endsWith('.svelte') ? [p] : [];
  });
}

describe('table header consistency (#1021)', () => {
  const owners = svelteFiles('src').filter((f) => {
    const src = readFileSync(f, 'utf8');
    return /<ViewTabs\b/.test(src) && !f.endsWith('TableFrame.svelte');
  });

  it('finds the grids that use the header', () => {
    expect(owners.length).toBeGreaterThanOrEqual(4);
  });

  it.each(owners)('%s draws its header inside TableFrame', (f) => {
    const src = readFileSync(f, 'utf8');
    expect(src).toMatch(/<TableFrame\b/);
    // The strip no longer sits on its own bordered line above the search row.
    expect(src).toMatch(/<ViewTabs[^>]*bordered=\{false\}/);
  });
});
