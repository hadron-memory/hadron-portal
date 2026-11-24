import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import baseline from './live-region-sites.baseline.json';
import { conditionalStatusRegions } from './live-region-sites.scan';

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
 * after merging main (it only lowers, and lists any addition it did not accept), then run
 * the suite again. Counts are per file, as the ratchet was designed (#2374): a swap within
 * one file keeps its count, so a new site can inherit a fixed site's slot. That gap is
 * disclosed and tracked as hadron-portal#2391 (a per-site-identity ratchet).
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


/** Sole-child sites reviewed and left alone on purpose. They stay counted here. */
const reviewedNotDefects: Record<string, string> = {
  'src/lib/components/SelectMemory.svelte': 'the guard is the static `keepOpen` mode flag; the region it renders is already persistent inside that mode',
  'src/lib/components/tickers/ApplyAgentTickers.svelte': 'the result container is an aria-live region mounted before any result, so the child is announced by it',
  // portal#2379: seen by the wider scan, reviewed, left alone. Each is a region that is already mounted
  // (the {#if} sits inside it, and the outer branch mounts the region with the view), so the content comes and
  // goes in an existing region. (A probe that mounts the page and changes it, not a read of the markup, is the
  // test of "present at load": the signing drifted/too-many notes and the customisation empty-list note looked
  // present at load and are not, so they are converted.)
  'src/lib/components/AgentChat.svelte': 'counted only because both notices are children of the active-chat branch of `{#if !activeChatId && !loadingChat}`; the region element mounts with the chat view and its own {#if} is INSIDE it, so a notice that arrives while the chat is open comes in an existing region. Residual: switching to a chat that already has a notice inserts the region with it, as opening that chat does',
  'src/lib/components/NodeList.svelte': 'counted only because node-columns-status is a child of the rows branch (`{#if nodes.length === 0}` ... `{:else}`); its own {#if} is INSIDE it, so loading and failed text that arrives while rows are shown comes in an existing region. Residual: rows returning after an empty result insert the region with its loading text; moving it out would reserve its min-h in the empty state',
  'src/routes/app/apps/[appId]/tasks/+page.svelte': 'counted only because both regions are children of the loaded-board branch; open-by-handle has its {#if} INSIDE it, and the Tasks-shown region is one live region per loaded board (portal#1403) whose count changes inside it'
};

describe('portal#2344: status regions are persistent, not mounted by an {#if} branch', () => {
  const counts = new Map<string, number>();
  for (const file of svelteFiles(SRC)) {
    const n = conditionalStatusRegions(readFileSync(file, 'utf8'));
    if (n) counts.set(relative(process.cwd(), file), n);
  }
  const base = baseline as Record<string, number>;
  // Regenerate the checked-in inventory from the scan. `UPDATE_LIVE_REGION_BASELINE=1` only LOWERS it (a
  // converted site comes off) and REPORTS every addition without accepting it, so rerunning cannot quietly
  // accept a regression: the "no file gains" test keeps failing until a person accepts the additions with
  // `UPDATE_LIVE_REGION_BASELINE=accept-additions` (and the reason goes in `reviewedNotDefects`).
  if (process.env.UPDATE_LIVE_REGION_BASELINE) {
    const accept = process.env.UPDATE_LIVE_REGION_BASELINE === 'accept-additions';
    const files = new Set([...counts.keys(), ...Object.keys(base)]);
    const next: Record<string, number> = {};
    const additions: string[] = [];
    for (const f of [...files].sort()) {
      const now = counts.get(f) ?? 0;
      const was = base[f] ?? 0;
      if (now > was) additions.push(`${f}: ${was} -> ${now}`);
      const keep = accept ? now : Math.min(now, was);
      if (keep > 0) next[f] = keep;
    }
    writeFileSync(join(process.cwd(), 'src/lib/live-region-sites.baseline.json'), `${JSON.stringify(next, null, 2)}\n`);
    if (additions.length) console.warn(`live-region baseline: ${accept ? 'ACCEPTED' : 'NOT accepted'} ${additions.length} addition(s):\n  ${additions.join('\n  ')}`);
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
    // The branches decide, not the words: an opaque branch may be 'status'; a name containing the word may not.
    expect(conditionalStatusRegions("{#if a}<p role={failed ? 'alert' : successRole}>x</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions("{#if a}<p role={statusReady ? 'dialog' : undefined}>x</p>{/if}")).toBe(0);
    expect(conditionalStatusRegions("{#if a}<p role={a ? 'alert' : b ? 'status' : 'alert'}>x</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions("{#if a}<p role={a ? 'alert' : b ? 'dialog' : 'alert'}>x</p>{/if}")).toBe(0);
    expect(conditionalStatusRegions("{#if a}<p role={a && 'alert'}>x</p>{/if}")).toBe(0);
    // A quoted expression is the same expression: judged by its branches, in either spelling.
    expect(conditionalStatusRegions("{#if a}<div role=\"{full ? 'dialog' : undefined}\">x</div>{/if}")).toBe(0);
    expect(conditionalStatusRegions("{#if a}<p role=\"{failed ? 'alert' : 'status'}\">x</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions('{#if a}<p role="{notice.role}">x</p>{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}<p role="x{kind}">x</p>{/if}')).toBe(1);
    // Templates: static ones are judged by their text, interpolated ones are unknown.
    expect(conditionalStatusRegions('{#if a}<p role={`status`}>x</p>{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}<p role={`dialog`}>x</p>{/if}')).toBe(0);
    expect(conditionalStatusRegions("{#if a}<p role={a ? `alert` : `status`}>x</p>{/if}")).toBe(1);
    expect(conditionalStatusRegions("{#if a}<p role={a ? `alert` : `dialog`}>x</p>{/if}")).toBe(0);
    expect(conditionalStatusRegions('{#if a}<p role={`${kind}`}>x</p>{/if}')).toBe(1);
    expect(conditionalStatusRegions('{#if a}<p role="alert">x</p>{/if}')).toBe(0);
    expect(conditionalStatusRegions('<LiveOutcome failed={f}>{#if m}<p>{m}</p>{/if}</LiveOutcome>')).toBe(0);
    expect(conditionalStatusRegions('<p role="status">{#if a}x{/if}</p>')).toBe(0);
  });

  it('no file gains a status region mounted by an {#if} branch', () => {
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
