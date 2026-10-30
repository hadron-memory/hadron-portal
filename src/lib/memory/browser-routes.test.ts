import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNodeDetailPath } from './is-node-detail';

// portal#1433 routing pin. Which routes drain the memory's whole node graph is
// decided by the filesystem: only what sits under `(browser)/` runs its
// `+layout.server.ts`. Pin the exact set, so a route that drifts into the group
// (paying 17 node + 12 edge pages) or Nodes/Graph drifting out (losing the one
// shared browser) is a red test, not a regression found in a profile.
const MEMORY = join(process.cwd(), 'src/routes/app/memories/[id]');

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (name === '+page.svelte' || name === '+page.server.ts' || name === '+server.ts') out.push(relative(MEMORY, dir).split(sep).join('/'));
  }
  return [...new Set(out)];
}

describe('(browser) route group membership (portal#1433)', () => {
  const all = routes(MEMORY);
  const inGroup = all.filter((r) => r.startsWith('(browser)')).sort();

  it('holds exactly the Nodes and Graph tabs', () => {
    expect(inGroup).toEqual(['(browser)/graph', '(browser)/nodes']);
  });

  it.each(['', 'info', 'settings', 'assets', 'nodes/[nodeId]', 'nodes/new', 'nodes/[nodeId]/chat', 'nodes/[nodeId]/deleted'])(
    '/%s sits outside the group, so it drains no graph',
    (r) => {
      expect(all).toContain(r);
      expect(r.startsWith('(browser)')).toBe(false);
    },
  );

  it('keeps the URLs: the group adds no path segment', () => {
    const urlOf = (r: string) => '/' + r.replace(/^\(browser\)\/?/, '');
    expect(inGroup.map(urlOf)).toEqual(['/graph', '/nodes']);
  });

  it('isNodeDetail (hides the tab strip) agrees with the group on every path', () => {
    const isNodeDetail = isNodeDetailPath; // the helper +layout.svelte uses
    expect(isNodeDetail('/app/memories/m/nodes')).toBe(false);
    expect(isNodeDetail('/app/memories/m/graph')).toBe(false);
    expect(isNodeDetail('/app/memories/m/nodes/abc')).toBe(true);
    expect(isNodeDetail('/app/memories/m/nodes/new')).toBe(true);
    expect(isNodeDetail('/app/memories/m/info')).toBe(false);
  });
});
