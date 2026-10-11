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

// The five grids that draw the header. Pinned by name so a grid that stops
// using the frame — or a new one that skips it — changes this list on purpose.
const EXPECTED = [
  'src/lib/components/AgentList.svelte',
  'src/lib/components/NodeList.svelte',
  'src/lib/components/NodeTable.svelte',
  'src/lib/components/table/DataTable.svelte',
  'src/lib/components/table/UsageEventsTable.svelte',
];

describe('table header consistency (#1021)', () => {
  const owners = svelteFiles('src')
    .filter((f) => /<ViewTabs\b/.test(readFileSync(f, 'utf8')) && !f.endsWith('TableFrame.svelte'))
    .map((f) => f.split('\\').join('/'))
    .sort();

  it('is exactly the five expected consumers', () => {
    expect(owners).toEqual(EXPECTED);
  });

  it.each(EXPECTED)('%s draws ViewTabs inside the frame\'s controls and the table inside the frame', (f) => {
    const src = readFileSync(f, 'utf8');
    const open = src.indexOf('<TableFrame');
    const close = src.indexOf('</TableFrame>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const tabs = src.indexOf('<ViewTabs');
    expect(tabs).toBeGreaterThan(open);
    expect(tabs).toBeLessThan(close);
    // The grid itself is framed too (NodeList frames it through a shared snippet).
    const table = src.indexOf('<table');
    expect(table === -1 || (table > open && table < close) || src.includes('{@render tableBody()}')).toBe(true);
    expect(src).toMatch(/<ViewTabs[^>]*bordered=\{false\}/);
  });
});
