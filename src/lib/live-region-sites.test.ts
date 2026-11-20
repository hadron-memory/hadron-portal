import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import baseline from './live-region-sites.baseline.json';

/**
 * portal#2344, hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
 *
 * Screen readers announce a CHANGE inside a live region that already exists. A
 * `role="status"` element that is the ONLY child of its own `{#if}` / `{:else}`
 * branch is inserted already populated and removed when the condition clears, so
 * it may never be announced. The fix is `LiveRegion`
 * (hrn:node:hadronmemory.com:hadron-portal:components:live-region): the region is
 * always mounted and the `{#if}` moves inside it.
 *
 * This scan finds the remaining sole-child regions per file. It is a RATCHET over
 * the sites not yet converted, and the checked-in baseline is the inventory of
 * what is left: a file may not gain a sole-child region, and when one is
 * converted the baseline must come down with it (so the number only falls).
 *
 * Two limits, both on the conservative side. It does not see a region that is one
 * child among several in its `{#if}` (the first child with siblings), and it does
 * not see an already-live ancestor container, so a listed site can be a false
 * positive. Reviewed non-defects are named in `reviewedNotDefects` below.
 */
const SRC = join(process.cwd(), 'src');

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) svelteFiles(p, out);
    else if (name.endsWith('.svelte')) out.push(p);
  }
  return out;
}

type Node = { type: string; data?: string; attributes?: Attr[]; fragment?: Fragment; consequent?: Fragment; alternate?: Fragment | null; body?: Fragment; fallback?: Fragment; pending?: Fragment; then?: Fragment; catch?: Fragment; children?: Node[]; nodes?: Node[] };
type Attr = { type: string; name?: string; value?: true | { type: string; data?: string }[] | { type: string } };
type Fragment = { nodes: Node[] };

/** True when the element carries a literal `role="status"` attribute (any quoting). */
function hasStatusRole(node: Node): boolean {
  return (node.attributes ?? []).some((a) => {
    if (a.type !== 'Attribute' || a.name !== 'role' || !Array.isArray(a.value) || a.value.length !== 1) return false;
    const v = a.value[0];
    return v.type === 'Text' && v.data?.trim() === 'status';
  });
}

/** How many `role="status"` elements are the only child of their own `{#if}`/`{:else}` branch. */
export function soleChildStatusRegions(src: string): number {
  const ast = parse(src, { modern: true }) as unknown as { fragment: Fragment };
  let count = 0;
  const branch = (f: Fragment | null | undefined) => {
    if (!f) return;
    const kids = f.nodes.filter((n) => !(n.type === 'Text' && !n.data?.trim()) && n.type !== 'Comment');
    if (kids.length === 1 && hasStatusRole(kids[0])) count++;
  };
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Node;
    if (node.type === 'IfBlock') {
      branch(node.consequent);
      if (node.alternate && !(node.alternate.nodes.length === 1 && node.alternate.nodes[0].type === 'IfBlock')) branch(node.alternate);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(ast.fragment);
  return count;
}

/** Sole-child sites reviewed and left alone on purpose. They stay counted here. */
const reviewedNotDefects: Record<string, string> = {
  'src/lib/components/SelectMemory.svelte': 'the guard is the static `keepOpen` mode flag; the region it renders is already persistent inside that mode',
  'src/lib/components/tickers/ApplyAgentTickers.svelte': 'the result container is an aria-live region mounted before any result, so the child is announced by it'
};

describe('portal#2344: status regions are persistent, not the only child of an {#if}', () => {
  const counts = new Map<string, number>();
  for (const file of svelteFiles(SRC)) {
    const n = soleChildStatusRegions(readFileSync(file, 'utf8'));
    if (n) counts.set(relative(process.cwd(), file), n);
  }
  const base = baseline as Record<string, number>;

  it('recognises the wrong shape and the right one', () => {
    expect(soleChildStatusRegions('{#if saved}<p role="status" class="x">{saved}</p>{/if}')).toBe(1);
    expect(soleChildStatusRegions('{#if a}\n  <div role="status">\n  <b>x</b></div>\n{:else}\n  y\n{/if}')).toBe(1);
    expect(soleChildStatusRegions('{#if a}x{:else}<p role="status">y</p>{/if}')).toBe(1);
    expect(soleChildStatusRegions('<LiveRegion>{#if saved}<p class="x">{saved}</p>{/if}</LiveRegion>')).toBe(0);
    expect(soleChildStatusRegions('<p role="status">{message}</p>')).toBe(0);
    expect(soleChildStatusRegions("{#if saved}<p role='status'>{saved}</p>{/if}")).toBe(1);
    expect(soleChildStatusRegions('{#if a}<p title="role=&quot;status&quot;">x</p>{/if}')).toBe(0);
    expect(soleChildStatusRegions('<!-- {#if a}<p role="status">x</p>{/if} -->')).toBe(0);
  });

  it('no file gains a sole-child status region', () => {
    const grew = [...counts].filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => `${f}: ${n} (baseline ${base[f] ?? 0})`);
    expect(grew, 'wrap the {#if} in <LiveRegion> instead of putting role="status" on the conditional element').toEqual([]);
  });

  it('the baseline comes down when a site is converted', () => {
    const stale = Object.entries(base).filter(([f, n]) => (counts.get(f) ?? 0) < n).map(([f, n]) => `${f}: baseline ${n}, now ${counts.get(f) ?? 0}`);
    expect(stale, 'lower live-region-sites.baseline.json to the new count').toEqual([]);
  });

  it('every reviewed non-defect is still a counted site with a reason', () => {
    for (const [f, why] of Object.entries(reviewedNotDefects)) {
      expect(counts.has(f), f).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });
});
