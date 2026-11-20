import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

/** Blank script, style and comments, keeping offsets, so only template markup is scanned. */
function template(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/<script[\s\S]*?<\/script>/g, blank)
    .replace(/<style[\s\S]*?<\/style>/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
}

/** How many `role="status"` elements are the only child of their own `{#if}`/`{:else}` branch. */
export function soleChildStatusRegions(src: string): number {
  const t = template(src);
  let count = 0;
  for (let at = t.indexOf('role="status"'); at !== -1; at = t.indexOf('role="status"', at + 1)) {
    const start = t.lastIndexOf('<', at);
    const tag = t.slice(start + 1).match(/^[A-Za-z][\w.]*/)?.[0];
    if (!tag) continue;
    // End of the opening tag, skipping braces and quotes.
    let i = at, depth = 0, quote: string | null = null;
    for (; i < t.length; i++) {
      const c = t[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    let end = i + 1;
    if (t[i - 1] !== '/') {
      const tokens = new RegExp(`<${tag}(?=[\\s>/])|</${tag}>`, 'g');
      tokens.lastIndex = i + 1;
      let open = 1, m: RegExpExecArray | null;
      while ((m = tokens.exec(t))) {
        if (m[0].startsWith('</')) { if (--open === 0) { end = m.index + m[0].length; break; } }
        else open++;
      }
    }
    const opensBranch = /(\{#if[^}]*\}|\{:else if[^}]*\}|\{:else\})\s*$/.test(t.slice(0, start));
    const closesBranch = /^\s*(\{\/if\}|\{:else)/.test(t.slice(end));
    if (opensBranch && closesBranch) count++;
  }
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
