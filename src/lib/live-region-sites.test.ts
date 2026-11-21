import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
 * It counts a `role="status"` region, or a `role={expression}` alert/status hybrid
 * (`LiveOutcome`'s case, portal#2379), that is a child of an `{#if}`/`{:else}` branch,
 * alone or among others, directly or through a `{#key}`. One limit, on the
 * conservative side: it does not see an already-live ancestor container, so a listed
 * site can be a false positive. Reviewed non-defects are named in `reviewedNotDefects`
 * below and stay counted.
 *
 * The baseline is derived from the scan, never merged by hand: run
 * `UPDATE_LIVE_REGION_BASELINE=1 pnpm vitest run --project node live-region-sites`
 * after merging main, then run the suite again.
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

type Node = { type: string; start?: number; data?: string; attributes?: Attr[]; fragment?: Fragment; consequent?: Fragment; alternate?: Fragment | null; body?: Fragment; fallback?: Fragment; pending?: Fragment; then?: Fragment; catch?: Fragment; children?: Node[]; nodes?: Node[] };
type Attr = { type: string; name?: string; value?: true | { type: string; data?: string }[] | { type: string; expression?: { type: string; start: number; end: number } } };
type Fragment = { nodes: Node[] };

/**
 * The role attribute of an element: a literal string; null for a `role={expression}` that can yield `status`
 * (a conditional naming it, or an opaque expression such as `notice.role`); 'other' for an expression that
 * cannot (`chatFullView ? 'dialog' : undefined`); undefined when absent.
 */
function roleOf(node: Node, src: string): string | null | undefined {
  const attr = (node.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'role');
  if (!attr) return undefined;
  if (Array.isArray(attr.value) && attr.value.length === 1 && attr.value[0].type === 'Text') return attr.value[0].data?.trim();
  const expression = attr.value && !Array.isArray(attr.value) && attr.value !== true ? attr.value.expression : undefined;
  if (expression && (expression.type === 'ConditionalExpression' || expression.type === 'Literal')) {
    return src.slice(expression.start, expression.end).includes('status') ? null : 'other';
  }
  return null;
}

/**
 * How many status regions are mounted by an `{#if}`/`{:else}` branch itself: a `role="status"`, or a
 * `role={expression}` (an alert/status hybrid, whose status half is inserted already populated), that is a
 * child of the branch, alone or among others, directly or through a `{#key}`. An element that is always
 * rendered with the `{#if}` INSIDE it is not a child of the branch, so it is never counted.
 */
export function conditionalStatusRegions(src: string): number {
  return conditionalStatusSites(src).length;
}

/** The 1-based line of each region counted by `conditionalStatusRegions`. */
export function conditionalStatusSites(src: string): number[] {
  const ast = parse(src, { modern: true }) as unknown as { fragment: Fragment };
  const sites: number[] = [];
  const direct = (nodes: Node[]): Node[] =>
    nodes.flatMap((n) => (n.type === 'KeyBlock' ? direct((n.fragment?.nodes ?? [])) : [n]));
  const branch = (f: Fragment | null | undefined) => {
    if (!f) return;
    for (const n of direct(f.nodes)) {
      if (n.type !== 'RegularElement' && n.type !== 'SvelteElement') continue;
      const role = roleOf(n, src);
      if (role === 'status' || role === null) sites.push(src.slice(0, n.start ?? 0).split('\n').length);
    }
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
  return sites;
}

/** Sole-child sites reviewed and left alone on purpose. They stay counted here. */
const reviewedNotDefects: Record<string, string> = {
  'src/lib/components/SelectMemory.svelte': 'the guard is the static `keepOpen` mode flag; the region it renders is already persistent inside that mode',
  'src/lib/components/tickers/ApplyAgentTickers.svelte': 'the result container is an aria-live region mounted before any result, so the child is announced by it',
  // portal#2379: seen by the wider scan, reviewed, left alone. Each is a region that is already mounted
  // (the {#if} sits inside it) or text that arrives with the page, so nothing is inserted already populated
  // after the region exists.
  'src/lib/components/AgentChat.svelte': 'the chat-progress and partial-turn notices are always-rendered role=status containers with the {#if} INSIDE them, mounted empty with the chat',
  'src/lib/components/InstallCustomisation.svelte': 'customisation-list-unavailable is a note rendered with the loaded read result (present at load); it is not an announcement of a change',
  'src/lib/components/NodeList.svelte': 'node-columns-status is always mounted with the {#if} inside it, so the loading and failed text is announced by an existing region',
  'src/routes/app/apps/[appId]/tasks/+page.svelte': 'open-by-handle is always mounted with the {#if} inside it; the Tasks-shown region is one live region per loaded board (portal#1403) and its count changes inside it',
  'src/routes/app/orgs/[id]/boot-prompt-signing/+page.svelte': 'the drifted and too-many notes are states of the loaded preview (present at load); the switched-on result has its own persistent region'
};

describe('portal#2344: status regions are persistent, not the only child of an {#if}', () => {
  const counts = new Map<string, number>();
  for (const file of svelteFiles(SRC)) {
    const n = conditionalStatusRegions(readFileSync(file, 'utf8'));
    if (n) counts.set(relative(process.cwd(), file), n);
  }
  const base = baseline as Record<string, number>;
  // Regenerate the checked-in inventory from the scan: `UPDATE_LIVE_REGION_BASELINE=1`, then run again.
  if (process.env.UPDATE_LIVE_REGION_BASELINE) {
    const sorted = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(join(process.cwd(), 'src/lib/live-region-sites.baseline.json'), `${JSON.stringify(sorted, null, 2)}\n`);
  }

  it('recognises the wrong shape and the right one', () => {
    expect(conditionalStatusRegions('{#if saved}<p role="status" class="x">{saved}</p>{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}\n  <div role="status">\n  <b>x</b></div>\n{:else}\n  y\n{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}x{:else}<p role="status">y</p>{/if}')).toBe(1);
    expect(conditionalStatusRegions('<LiveRegion>{#if saved}<p class="x">{saved}</p>{/if}</LiveRegion>')).toBe(0);
    expect(conditionalStatusRegions('<p role="status">{message}</p>')).toBe(0);
    expect(conditionalStatusRegions("{#if saved}<p role='status'>{saved}</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions('{#if a}<p title=\'role="status"\'>x</p>{/if}')).toBe(0);
    expect(conditionalStatusRegions('<!-- {#if a}<p role="status">x</p>{/if} -->')).toBe(0);
    // portal#2379: one among several, through a {#key}, and the dynamic-role hybrids.
    expect(conditionalStatusRegions('{#if a}<h3>t</h3><p role="status">{a}</p><button>b</button>{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}{#key a.role}<div role={a.role}>{a.text}</div>{/key}{/if}')).toBe(1);
    expect(conditionalStatusRegions("{#if m}<p role={m.type === 'error' ? 'alert' : 'status'}>{m.text}</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions("{#if ok}<p role={ok ? 'status' : 'alert'}>x</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions("{#if a}<div role={full ? 'dialog' : undefined}>x</div>{/if}")).toBe(0);
    expect(conditionalStatusRegions('{#if a}<p role="alert">x</p>{/if}')).toBe(0);
    expect(conditionalStatusRegions('<LiveOutcome failed={f}>{#if m}<p>{m}</p>{/if}</LiveOutcome>')).toBe(0);
    expect(conditionalStatusRegions('<p role="status">{#if a}x{/if}</p>')).toBe(0);
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
