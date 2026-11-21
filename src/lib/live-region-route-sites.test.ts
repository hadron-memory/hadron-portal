import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locateRegion } from '$lib/test/liveRegionSites';

/**
 * portal#2375 (slice 2, part B of #2344): the converted route-page action results. A screen
 * reader announces a CHANGE inside a live region that already exists, so each result must sit
 * inside an always-mounted `<LiveRegion>` whose ONLY child is the `{#if}` that holds it, and
 * that region must not be mounted by anything that turns true with its own result. (The
 * region's own lifecycle, exists and empty before, text during, same element after, is pinned in
 * `components/LiveRegion.client.test.ts`; real mounts exist for WorkerDeleteDialog and
 * ChangeWorkerAgent; the other pages are pinned here and driven by the browser QA seat.)
 *
 * Static analysis cannot tell a result-dependent guard from a static one: a derived
 * `{#if resultVisible}` looks like `{#if canEdit}`. So `gates` below is the COMPLETE list of
 * control-flow ancestors (if / each / key / await, outermost first) a reviewer has read for that
 * site and judged independent of the result (a tab, a permission, load data, or an outcome that
 * is already true before the action). Any new, changed or derived ancestor fails the row until
 * someone reads it again, which is the point.
 *
 * `marker` is matched in rendered text and `{expression}` tags only (never a script, an `{#if}`
 * condition, a comment or an attribute), or in element attributes when `attr` is set (a
 * `data-testid`); `occurrence` (0-based) counts among those matches when the same text also
 * appears at a site another slice owns. Each gate names the BRANCH the region is in.
 */
type LiveRegionCase = { file: string; marker: string; occurrence?: number; attr?: boolean; gates: string[] };
const R = 'src/routes/';
const LIVE_REGION_CASES: LiveRegionCase[] = [
  { file: R + "app/marketplace/+page.svelte", marker: "{addToAgentSuccess}", gates: ["if memories.length > 0", "each memories (key memory.id)", "if canAdopt"] },
  { file: R + "app/memories/+page.svelte", marker: "memory-transfer.done-other-user", gates: [] },
  { file: R + "app/memories/[id]/integrations/+page.svelte", marker: "{successMessage}", gates: [] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/+page.svelte", marker: "data-testid=\"approval-success\"", attr: true, gates: [] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/+page.svelte", marker: "{flowActionSuccess}", gates: ["if activeTab === 'flow'"] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/+page.svelte", marker: "{edgesActionSuccess}", gates: ["if activeTab === 'references'"] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/+page.svelte", marker: "{updateMetaActionSuccess}", gates: ["if activeTab === 'settings' || activeTab === 'info'"] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/NodeStorageForm.svelte", marker: "{actionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/nodes/[nodeId]/edges/[edgeId]/+page.svelte", marker: "{actionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/settings/+page.svelte", marker: "{settingsActionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/settings/+page.svelte", marker: "{vectorActionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/settings/+page.svelte", marker: "memory-settings.retry-embeds.none", gates: ["if g.vectorIndexEnabled && canRetryEmbeds"] },
  { file: R + "app/memories/[id]/settings/+page.svelte", marker: "{schemaActionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/settings/+page.svelte", marker: "'memory-transfer.done'", gates: ["if canTransfer"] },
  { file: R + "app/memories/[id]/settings/MarketplaceListingCard.svelte", marker: "{marketplaceActionSuccess}", gates: [] },
  { file: R + "app/memories/[id]/subscriptions/+page.svelte", marker: "{actionSuccess ?? unsubscribeActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/+page.svelte", marker: "org.signing.switched-off", gates: ["if signingOutcome !== 'hidden' && signing.kind !== 'hidden'", "else of if signing.kind === 'failed'"] },
  { file: R + "app/orgs/[id]/agents/+page.svelte", marker: "{subscribeActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/agents/+page.svelte", marker: "{unsubscribeActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/apps/+page.svelte", marker: "{deleteActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/boot-prompt-signing/+page.svelte", marker: "org.signing.stale", occurrence: 1, gates: ["else of if done && form && 'signing' in form && form.signing", "else of if data.sw.kind === 'failed' || preview?.kind === 'failed'", "else of if data.sw.kind === 'ok' && data.sw.required", "else of if outcome === 'hidden'", "else of if preview?.kind === 'drifted'", "else of if preview?.kind === 'too_many'", "if preview?.kind === 'ok'"] },
  { file: R + "app/orgs/[id]/exchange/[connectionId]/+page.svelte", marker: "{replyActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/exchange/[connectionId]/+page.svelte", marker: "{moveActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "{githubInstallationActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "{githubAppActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "{unlinkGithubActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "Hadron GitHub App installed and linked", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "Microsoft Exchange connected successfully.", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "{deleteExchangeConnectionActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/integrations/+page.svelte", marker: "{testExchangeConnectionActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/members/+page.svelte", marker: "{updateActionSuccess ?? removeActionSuccess}", gates: [] },
  { file: R + "app/orgs/[id]/memories/+page.svelte", marker: "{deleteActionSuccess ?? syncAllActionSuccess", gates: [] },
  { file: R + "app/workers/[id]/ChangeWorkerAgent.svelte", marker: "data-testid=\"change-agent-done\"", attr: true, gates: [] },
  { file: R + "app/workers/[id]/WorkerLeaveAlone.svelte", marker: "worker.leave-alone.unconfirmed", gates: ["if marker", "if canManage && !retired"] },
  { file: R + "app/workers/[id]/WorkerLeaveAlone.svelte", marker: "{feedback.text}", occurrence: 1, gates: ["if marker", "if canManage && !retired"] },
  { file: R + "contact/+page.svelte", marker: "{successMessage}", gates: [] },
  { file: R + "invite/[token]/+page.svelte", marker: "{emailSentMessage}", gates: ["else of if !inv", "else of if expired", "else of if maxedOut", "else of if data.isSignedIn"] },
  { file: R + "signin/+page.svelte", marker: "{successMessage}", gates: [] },
  { file: R + "signup/+page.svelte", marker: "{successMessage}", gates: [] },
  { file: "src/lib/components/AgentInheritanceSettings.svelte", marker: "agent.parent.unsaved-replace", gates: ["else of if management.error", "if management.canManage && management.refs"] },
  { file: "src/lib/components/AgentInheritanceSettings.svelte", marker: "agent.parent.unsaved-set", gates: ["else of if management.error", "if management.canManage && management.refs"] },
  { file: "src/lib/components/WorkerDeleteDialog.svelte", marker: "app.staff.delete.pending", gates: [] },
  { file: "src/lib/components/agent-tasks/TaskFindings.svelte", marker: "app.tasks.disposition.saving", gates: ["if editing", "key editing.id"] },
  { file: "src/lib/components/agent-tasks/TaskPlanning.svelte", marker: "t('app.tasks.saving'", gates: [] },
];

const IMP = "<script>import LiveRegion from '$lib/components/LiveRegion.svelte';</script>";
const gatesOf = (markup: string, marker = 'MARK') => locateRegion(IMP + markup, marker)?.gates ?? null;

describe('portal#2375: route-page action results sit in a persistent LiveRegion', () => {
  it('finds the right shape and reports its ancestors', () => {
    expect(gatesOf('<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>')).toEqual([]);
    expect(gatesOf('{#if canEdit}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}')).toEqual(['if canEdit']);
    expect(gatesOf('{#key n}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/key}')).toEqual(['key n']);
    expect(gatesOf('{#each rows as r}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/each}')).toEqual(['each rows']);
  });

  it('a wrapper mounted by a derived or differently named guard still reports it (George and Beckett, #2382)', () => {
    // identifiers share nothing with the inner test, so only an explicit list can catch it
    expect(gatesOf('{#if showResult}<LiveRegion>{#if result}<p>MARK</p>{/if}</LiveRegion>{/if}')).toEqual(['if showResult']);
    expect(gatesOf('{#if resultVisible}<LiveRegion>{#if successMessage}<p>MARK</p>{/if}</LiveRegion>{/if}')).toEqual(['if resultVisible']);
    // a second, unsafe ancestor added next to a reviewed one changes the list
    expect(gatesOf('{#if canEdit}{#if showResult}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}{/if}')).not.toEqual(['if canEdit']);
  });

  it('records the branch, so moving a region between branches of an unchanged guard changes the list (Beckett, #2382)', () => {
    const inElse = gatesOf('{#if outcome === "hidden"}<b>x</b>{:else}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}');
    const inThen = gatesOf('{#if outcome === "hidden"}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{:else}<b>x</b>{/if}');
    expect(inElse).toEqual(['else of if outcome === "hidden"']);
    expect(inThen).toEqual(['if outcome === "hidden"']);
    // a keyed each: a different key can replace the row without changing the collection
    expect(gatesOf('{#each rows as r (r.id)}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/each}')).toEqual(['each rows (key r.id)']);
    expect(gatesOf('{#each rows as r (n)}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/each}')).not.toEqual(['each rows (key r.id)']);
  });

  it('matches the marker in rendered text, not in an attribute, a nested condition or a script', () => {
    expect(gatesOf('<LiveRegion>{#if a}<p title="MARK">Other</p>{/if}</LiveRegion>')).toBeNull();
    expect(gatesOf("<LiveRegion>{#if a}{#if v === 'MARK'}<p>Other</p>{/if}{/if}</LiveRegion>")).toBeNull();
    // an earlier occurrence in a script does not shift which site is selected
    const withScript = "<script>import LiveRegion from '$lib/components/LiveRegion.svelte'; const s = 'MARK';</script><LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>";
    expect(locateRegion(withScript, 'MARK', 0)?.gates).toEqual([]);
    // an attribute marker is selected explicitly
    expect(locateRegion(IMP + '<LiveRegion>{#if a}<p data-testid="done">x</p>{/if}</LiveRegion>', 'data-testid="done"', 0, true)?.gates).toEqual([]);
  });

  it('rejects what is not a persistent region around the marker', () => {
    expect(gatesOf('{#if a}<LiveRegion><p>MARK</p></LiveRegion>{/if}')).toBeNull(); // no inner {#if}
    expect(gatesOf('<LiveRegion>{#if a}<p>x</p>{/if}<b>MARK</b></LiveRegion>')).toBeNull(); // not the only child
    expect(gatesOf('<LiveRegion>{#if a}<p>x</p>{/if}</LiveRegion><p>MARK</p>')).toBeNull(); // marker outside
    expect(gatesOf('<LiveRegion data-x="MARK">{#if a}<p>y</p>{/if}</LiveRegion>')).toBeNull(); // attribute
    expect(gatesOf("<LiveRegion>{#if value === 'MARK'}<p>Other</p>{/if}</LiveRegion>")).toBeNull(); // condition only
    expect(gatesOf('<!-- MARK --><LiveRegion>{#if a}<p>y</p>{/if}</LiveRegion>')).toBeNull(); // comment
    expect(gatesOf('{#if a}<p role="status">MARK</p>{/if}')).toBeNull(); // no region at all
  });

  it('flags a status role nested inside the region, whatever the spacing or quoting', () => {
    for (const attr of ['role="status"', 'role = "status"', "role='status'", 'role=status']) {
      const l = locateRegion(IMP + `<LiveRegion>{#if a}<p ${attr}>MARK</p>{/if}</LiveRegion>`, 'MARK');
      expect(l?.hasNestedStatusRole, attr).toBe(true);
    }
    expect(locateRegion(IMP + '<!-- role="status" --><LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>', 'MARK')?.hasNestedStatusRole).toBe(false);
  });

  it.each(LIVE_REGION_CASES.map((c) => [c.file.replace(/^src\//, ''), c.marker.slice(0, 48), c] as const))('%s: %s', (_f, _m, c) => {
    const src = readFileSync(join(process.cwd(), c.file), 'utf8');
    const located = locateRegion(src, c.marker, c.occurrence ?? 0, c.attr);
    expect(located, 'the marker is not inside the {#if} of a LiveRegion that has it as its only child').not.toBeNull();
    expect(located!.hasNestedStatusRole, 'a role="status" is nested inside the region').toBe(false);
    expect(located!.gates, 'the ancestors of this region changed: read each one, then update the list').toEqual(c.gates);
  });

  it('names every converted site once (44)', () => {
    expect(LIVE_REGION_CASES.length).toBe(44);
    expect(new Set(LIVE_REGION_CASES.map((c) => c.file + '|' + c.marker + '|' + (c.occurrence ?? 0))).size).toBe(44);
  });
});
