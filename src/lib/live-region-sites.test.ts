import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import baseline from './live-region-sites.baseline.json';
import { countConditionalStatusRegions, nextBaseline, ratchetDiff, scanStatusSites } from './live-region-sites.scan';

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
 *
 * Every baseline site is on exactly one of two lists below. `reviewedNotDefects` holds sites someone has judged and
 * left alone, each with its reason. `unreviewedSites` holds sites nobody has reviewed yet, neither converted nor
 * judged: listing a site there records it as open inventory with a tracking issue, never as acceptable, and it comes
 * off when the site is converted or moves to `reviewedNotDefects`. It is empty when nothing is outstanding.
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
  'src/routes/app/apps/[appId]/tasks/+page.svelte#div:3f0d1e2f': 'counted only because both regions are children of the loaded-board branch; open-by-handle has its {#if} INSIDE it, and the Tasks-shown region is one live region per loaded board (portal#1403) whose count changes inside it',
  'src/lib/components/ErrorPage.svelte#span:924f805e': "the copy-status span mounts with the request-id row, which the error page renders from first paint (`requestId` is a load-time prop); `notice` changes inside the existing region after the Copy click",
  'src/lib/components/InstallCustomisation.svelte#p:9e6346f9': "the region mounts EMPTY with the editor panel (its comment cites #1369) and a save result arrives inside it; the panel opening announces nothing because `feedback` starts empty",
  'src/lib/components/MemoryBrowser.svelte#testid:property-filter-status': "the region mounts with the open Properties panel, outside the keyed editor; the status changes inside it while the panel is open, and nothing needs announcing at the moment the panel opens",
  'src/lib/components/flow/ConversationInfoPanel.svelte#div:f5ed1424': "the region mounts with the ordering controls once the conversation has a start order, and its own {#if moved} is INSIDE it, so \"Moved to n of total\" arrives in an existing region",
  'src/lib/components/memory-config/BulkApply.svelte#p:93003cab': "the count note mounts with the picker row whenever the panel is not locked and changes inside it as the selection changes; `locked` (an apply in flight) removes it and nothing is meant to be announced then. Residual: when the panel unlocks the region mounts with the current count note already in it, which is state, not a change",
  'src/lib/components/memory-config/TemplatesManager.svelte#div:5211f6ab': "the region mounts EMPTY with the apply panel (no preview, so no warnings) and the warnings arrive inside it after Preview; its content is the {#each} inside TaskWarnings, not the region",
  'src/lib/components/tickers/TickerEnabledControl.svelte#testid:ticker-enabled-result': "the branch is `{#if impersonating}...{:else}`, fixed for the whole session; the result span mounts empty with the control and its own {#if ok} is INSIDE it",
  'src/routes/app/agents/[id]/AgentMemberRolesEditor.svelte#p:776e5737': "the branch is `{#if canManage}`, which comes from the page load; an invalidation that flips it mounts the whole editor, as opening it does, and `announcement` changes inside the region while the editor is there",
  'src/routes/app/apps/[appId]/+page.svelte#testid:cast-refresh-status': "the region mounts EMPTY with the AI Team tab panel (portal#1715) and its own {#if castRefreshFailed} is INSIDE it, so the failure arrives in an existing region",
  'src/routes/app/apps/[appId]/+page.svelte#testid:key-copy-status': "the region mounts with the API keys tab panel before any copy (portal#2330) and its own {#if} is INSIDE it, so the copy result arrives in an existing region",
  'src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte#span:7ed159ba': "the status span mounts with the Show more row, which exists while more children remain; the \"Showing the first n\" count and the failure text change inside it, so an update arrives in an existing region"
};


/** Sites nobody has reviewed yet: see the header. Empty when nothing is outstanding. */
const unreviewedSites: string[] = [];

const BASELINE_PATH = join(process.cwd(), 'src/lib/live-region-sites.baseline.json');

describe('portal#2344: status regions are persistent, not mounted by an {#if} branch', () => {
  const now = new Map<string, string[]>();
  const lineOf = new Map<string, number>();
  for (const file of svelteFiles(SRC)) {
    const rel = relative(process.cwd(), file);
    const sites = scanStatusSites(readFileSync(file, 'utf8'));
    if (sites.length) now.set(rel, sites.map((x) => x.identity));
    for (const x of sites) lineOf.set(`${rel}#${x.identity}`, x.line);
  }
  const where = (site: string) => `${site.split('#')[0]}:${lineOf.get(site) ?? '?'}#${site.split('#').slice(1).join('#')}`;
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
    const next = nextBaseline(base, now, accept);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    if (removed.length) console.warn(`live-region baseline: removed ${removed.length} site(s):\n  ${removed.map(where).join('\n  ')}`);
    if (added.length) console.warn(`live-region baseline: ${accept ? 'ACCEPTED' : 'NOT accepted'} ${added.length} addition(s):\n  ${added.map(where).join('\n  ')}`);
  }

  it('recognises the wrong shape and the right one', () => {
    expect(countConditionalStatusRegions('{#if saved}<p role="status" class="x">{saved}</p>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}\n  <div role="status">\n  <b>x</b></div>\n{:else}\n  y\n{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}x{:else}<p role="status">y</p>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('<LiveRegion>{#if saved}<p class="x">{saved}</p>{/if}</LiveRegion>')).toBe(0);
    expect(countConditionalStatusRegions('<p role="status">{message}</p>')).toBe(0);
    expect(countConditionalStatusRegions("{#if saved}<p role='status'>{saved}</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions('{#if a}<p title=\'role="status"\'>x</p>{/if}')).toBe(0);
    expect(countConditionalStatusRegions('<!-- {#if a}<p role="status">x</p>{/if} -->')).toBe(0);
    // portal#2379: one among several, through a {#key}, and the dynamic-role hybrids.
    expect(countConditionalStatusRegions('{#if a}<h3>t</h3><p role="status">{a}</p><button>b</button>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}{#key a.role}<div role={a.role}>{a.text}</div>{/key}{/if}')).toBe(1);
    expect(countConditionalStatusRegions("{#if m}<p role={m.type === 'error' ? 'alert' : 'status'}>{m.text}</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions("{#if ok}<p role={ok ? 'status' : 'alert'}>x</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions("{#if a}<div role={full ? 'dialog' : undefined}>x</div>{/if}")).toBe(0);
    // The branches decide, not the words: an opaque branch may be 'status'; a name containing the word may not.
    expect(countConditionalStatusRegions("{#if a}<p role={failed ? 'alert' : successRole}>x</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions("{#if a}<p role={statusReady ? 'dialog' : undefined}>x</p>{/if}")).toBe(0);
    expect(countConditionalStatusRegions("{#if a}<p role={a ? 'alert' : b ? 'status' : 'alert'}>x</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions("{#if a}<p role={a ? 'alert' : b ? 'dialog' : 'alert'}>x</p>{/if}")).toBe(0);
    expect(countConditionalStatusRegions("{#if a}<p role={a && 'alert'}>x</p>{/if}")).toBe(0);
    // A quoted expression is the same expression: judged by its branches, in either spelling.
    expect(countConditionalStatusRegions("{#if a}<div role=\"{full ? 'dialog' : undefined}\">x</div>{/if}")).toBe(0);
    expect(countConditionalStatusRegions("{#if a}<p role=\"{failed ? 'alert' : 'status'}\">x</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions('{#if a}<p role="{notice.role}">x</p>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}<p role="x{kind}">x</p>{/if}')).toBe(1);
    // Templates: static ones are judged by their text, interpolated ones are unknown.
    expect(countConditionalStatusRegions('{#if a}<p role={`status`}>x</p>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}<p role={`dialog`}>x</p>{/if}')).toBe(0);
    expect(countConditionalStatusRegions("{#if a}<p role={a ? `alert` : `status`}>x</p>{/if}")).toBe(1);
    expect(countConditionalStatusRegions("{#if a}<p role={a ? `alert` : `dialog`}>x</p>{/if}")).toBe(0);
    expect(countConditionalStatusRegions('{#if a}<p role={`${kind}`}>x</p>{/if}')).toBe(1);
    expect(countConditionalStatusRegions('{#if a}<p role="alert">x</p>{/if}')).toBe(0);
    expect(countConditionalStatusRegions('<LiveOutcome failed={f}>{#if m}<p>{m}</p>{/if}</LiveOutcome>')).toBe(0);
    expect(countConditionalStatusRegions('<p role="status">{#if a}x{/if}</p>')).toBe(0);
  });

  it('no site is added: a status region mounted by an {#if} branch', () => {
    expect(diff().added.map(where), 'wrap the {#if} in <LiveRegion> instead of putting role="status" on the conditional element').toEqual([]);
  });

  it('the baseline comes down when a site is converted or removed', () => {
    expect(diff().removed.map(where), 'run UPDATE_LIVE_REGION_BASELINE=1 to lower live-region-sites.baseline.json').toEqual([]);
  });

  it('every reviewed non-defect is a counted site with a reason', () => {
    const counted = new Set([...now].flatMap(([f, ids]) => ids.map((i) => `${f}#${i}`)));
    for (const [site, why] of Object.entries(reviewedNotDefects)) {
      expect(counted.has(site), site).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('every baseline site is reviewed or on the unreviewed list, and neither list holds a stale site', () => {
    const inBaseline = new Set(Object.entries(base).flatMap(([f, l]) => l.map((i) => `${f}#${i}`)));
    const reviewed = new Set(Object.keys(reviewedNotDefects));
    const unreviewed = new Set(unreviewedSites);
    expect([...inBaseline].filter((s) => !reviewed.has(s) && !unreviewed.has(s)), 'record the site in reviewedNotDefects (with a reason) or unreviewedSites (tracked in #2581)').toEqual([]);
    expect([...unreviewed].filter((s) => !inBaseline.has(s)), 'a converted site comes off unreviewedSites').toEqual([]);
    expect([...unreviewed].filter((s) => reviewed.has(s)), 'a site is reviewed or unreviewed, not both').toEqual([]);
  });
});
