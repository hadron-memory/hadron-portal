import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import baseline from './live-region-sites.baseline.json';
import { conditionalStatusIdentities, conditionalStatusRegions, ratchetDiff } from './live-region-sites.scan';

/**
 * portal#2344, portal#2391, hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
 *
 * Screen readers announce a CHANGE inside a live region that already exists. A
 * `role="status"` element that is mounted by an `{#if}` / `{:else}` branch is inserted already
 * populated and removed when the condition clears, so it may never be announced. The fix is `LiveRegion`
 * (hrn:node:hadronmemory.com:hadron-portal:components:live-region): the region is
 * always mounted and the `{#if}` moves inside it.
 *
 * This scan finds the remaining such regions. It is a RATCHET over the sites not yet converted, and the
 * checked-in baseline is the inventory of what is left, as `file: [site identity, ...]`. A site's identity is
 * its `data-testid`, else a hash of its opening tag and enclosing branch condition (see
 * `conditionalStatusIdentities`), never a line number. A site may not be added, and when one is converted the
 * baseline must come down with it. Because sites are tracked one by one, fixing one site and adding another in
 * the same file is an addition plus a removal, reported separately, and no longer passes as "no change".
 *
 * It counts a `role="status"` region, or a `role={expression}` alert/status hybrid
 * (`LiveOutcome`'s case, portal#2379), that is a child of an `{#if}`/`{:else}` branch, alone or among others,
 * directly, through a `{#key}`, or nested in plain elements. One limit, on the conservative side: it does not
 * see an already-live ancestor container, so a listed site can be a false positive. Reviewed non-defects are
 * named by site identity in `reviewedNotDefects` below and stay counted.
 *
 * The baseline is derived from the scan, never merged by hand: run
 * `UPDATE_LIVE_REGION_BASELINE=1 pnpm vitest run --project node live-region-sites`
 * after merging main (it only lowers, and lists additions it did not accept and removals it applied), then run
 * the suite again. `UPDATE_LIVE_REGION_BASELINE=accept-additions` takes additions, and each needs a reason in
 * `reviewedNotDefects` or a conversion tracked elsewhere.
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


/** Sites reviewed and left alone on purpose, keyed `file#identity`. They stay counted here. */
const reviewedNotDefects: Record<string, string> = {
  'src/lib/components/SelectMemory.svelte#p:d503ccea': 'the guard is the static `keepOpen` mode flag; the region it renders is already persistent inside that mode',
  'src/lib/components/tickers/ApplyAgentTickers.svelte#testid:apply-receipt': 'the result container is an aria-live region mounted before any result, so the child is announced by it',
  'src/lib/components/tickers/ApplyAgentTickers.svelte#testid:apply-refresh-failed': 'the result container is an aria-live region mounted before any result, so the child is announced by it',
  'src/lib/components/AgentChat.svelte#testid:chat-progress-notice': 'counted only because both notices are children of the active-chat branch of `{#if !activeChatId && !loadingChat}`; the region element mounts with the chat view and its own {#if} is INSIDE it, so a notice that arrives while the chat is open comes in an existing region. Residual: switching to a chat that already has a notice inserts the region with it, as opening that chat does',
  'src/lib/components/AgentChat.svelte#testid:partial-turn-notice': 'counted only because both notices are children of the active-chat branch of `{#if !activeChatId && !loadingChat}`; the region element mounts with the chat view and its own {#if} is INSIDE it, so a notice that arrives while the chat is open comes in an existing region. Residual: switching to a chat that already has a notice inserts the region with it, as opening that chat does',
  'src/lib/components/NodeList.svelte#testid:node-columns-status': 'counted only because node-columns-status is a child of the rows branch (`{#if nodes.length === 0}` ... `{:else}`); its own {#if} is INSIDE it, so loading and failed text that arrives while rows are shown comes in an existing region. Residual: rows returning after an empty result insert the region with its loading text; moving it out would reserve its min-h in the empty state',
  'src/routes/app/apps/[appId]/tasks/+page.svelte#testid:open-by-handle': 'counted only because both regions are children of the loaded-board branch; open-by-handle has its {#if} INSIDE it, and the Tasks-shown region is one live region per loaded board (portal#1403) whose count changes inside it',
  'src/routes/app/apps/[appId]/tasks/+page.svelte#div:3f0d1e2f': 'counted only because both regions are children of the loaded-board branch; open-by-handle has its {#if} INSIDE it, and the Tasks-shown region is one live region per loaded board (portal#1403) whose count changes inside it'
};

const BASELINE_PATH = join(process.cwd(), 'src/lib/live-region-sites.baseline.json');

describe('portal#2344: status regions are persistent, not mounted by an {#if} branch', () => {
  const now = new Map<string, string[]>();
  for (const file of svelteFiles(SRC)) {
    const ids = conditionalStatusIdentities(readFileSync(file, 'utf8'));
    if (ids.length) now.set(relative(process.cwd(), file), ids);
  }
  const base = baseline as Record<string, string[]>;
  const diff = () => {
    const added: string[] = [];
    const removed: string[] = [];
    for (const f of new Set([...now.keys(), ...Object.keys(base)])) {
      const d = ratchetDiff(base[f] ?? [], now.get(f) ?? []);
      added.push(...d.added.map((i) => `${f}#${i}`));
      removed.push(...d.removed.map((i) => `${f}#${i}`));
    }
    return { added, removed };
  };
  // Regenerate the checked-in inventory from the scan. `UPDATE_LIVE_REGION_BASELINE=1` only LOWERS it (a
  // converted site comes off) and REPORTS every addition without accepting it, so rerunning cannot quietly
  // accept a regression: the "no site is added" test keeps failing until a person accepts the additions with
  // `UPDATE_LIVE_REGION_BASELINE=accept-additions`.
  if (process.env.UPDATE_LIVE_REGION_BASELINE) {
    const accept = process.env.UPDATE_LIVE_REGION_BASELINE === 'accept-additions';
    const { added, removed } = diff();
    const next: Record<string, string[]> = {};
    for (const f of [...new Set([...now.keys(), ...Object.keys(base)])].sort()) {
      const keep = (now.get(f) ?? []).filter((i) => accept || (base[f] ?? []).includes(i));
      if (keep.length) next[f] = keep;
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    if (removed.length) console.warn(`live-region baseline: removed ${removed.length} site(s):\n  ${removed.join('\n  ')}`);
    if (added.length) console.warn(`live-region baseline: ${accept ? 'ACCEPTED' : 'NOT accepted'} ${added.length} addition(s):\n  ${added.join('\n  ')}`);
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

  it('no site is added: a status region mounted by an {#if} branch', () => {
    expect(diff().added, 'wrap the {#if} in <LiveRegion> instead of putting role="status" on the conditional element').toEqual([]);
  });

  it('the baseline comes down when a site is converted or removed', () => {
    expect(diff().removed, 'run UPDATE_LIVE_REGION_BASELINE=1 to lower live-region-sites.baseline.json').toEqual([]);
  });

  it('every reviewed non-defect is a counted site with a reason', () => {
    const counted = new Set([...now].flatMap(([f, ids]) => ids.map((i) => `${f}#${i}`)));
    for (const [site, why] of Object.entries(reviewedNotDefects)) {
      expect(counted.has(site), site).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });
});
