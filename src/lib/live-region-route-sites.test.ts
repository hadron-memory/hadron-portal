import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';

/**
 * portal#2375 (slice 2, part B of #2344): the converted route-page action
 * results. A screen reader announces a CHANGE inside a live region that already
 * exists, so each result must sit inside an always-mounted `<LiveRegion>` whose
 * ONLY child is the `{#if}` that holds it (the lifecycle of `LiveRegion` itself,
 * exists and empty before, text during, same element after, is pinned in
 * `components/LiveRegion.client.test.ts`).
 *
 * These pages are 150 to 4600 lines of form state and are not mounted in a test,
 * so the per-site pin is structural: parse the page and require the marker's
 * `{#if}` to be the sole child of a `LiveRegion`, and no `role="status"` left on
 * a conditional element carrying it. On main every row fails: none of these
 * pages has a `LiveRegion` around the marker.
 *
 * `marker` is a text that occurs only inside that one result's box.
 */
/** One converted result: `marker` is text only inside its box; `occurrence` (0-based) picks which match when the text also appears at a site another slice owns. */
type ConvertedSite = { file: string; marker: string; occurrence?: number; sharedGuard?: string };
const R = 'src/routes/';
const SITES: ConvertedSite[] = [
  { file: R + 'app/marketplace/+page.svelte', marker: '{addToAgentSuccess}' },
  { file: R + 'app/memories/+page.svelte', marker: 'memory-transfer.done-other-user' },
  { file: R + 'app/memories/[id]/integrations/+page.svelte', marker: '{successMessage}' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/+page.svelte', marker: 'data-testid="approval-success"' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/+page.svelte', marker: '{flowActionSuccess}' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/+page.svelte', marker: '{edgesActionSuccess}' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/+page.svelte', marker: '{updateMetaActionSuccess}' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/NodeStorageForm.svelte', marker: '{actionSuccess}' },
  { file: R + 'app/memories/[id]/nodes/[nodeId]/edges/[edgeId]/+page.svelte', marker: '{actionSuccess}' },
  { file: R + 'app/memories/[id]/settings/+page.svelte', marker: '{settingsActionSuccess}' },
  { file: R + 'app/memories/[id]/settings/+page.svelte', marker: '{vectorActionSuccess}' },
  { file: R + 'app/memories/[id]/settings/+page.svelte', marker: 'memory-settings.retry-embeds.none' },
  { file: R + 'app/memories/[id]/settings/+page.svelte', marker: '{schemaActionSuccess}' },
  { file: R + 'app/memories/[id]/settings/+page.svelte', marker: "'memory-transfer.done'" },
  { file: R + 'app/memories/[id]/settings/MarketplaceListingCard.svelte', marker: '{marketplaceActionSuccess}' },
  { file: R + 'app/memories/[id]/subscriptions/+page.svelte', marker: '{actionSuccess ?? unsubscribeActionSuccess}' },
  { file: R + 'app/orgs/[id]/+page.svelte', marker: 'org.signing.switched-off', sharedGuard: "the outer guard is `signingOutcome !== 'hidden'`, true before any action (outcome is null), so the region is mounted at load" },
  { file: R + 'app/orgs/[id]/agents/+page.svelte', marker: '{subscribeActionSuccess}' },
  { file: R + 'app/orgs/[id]/agents/+page.svelte', marker: '{unsubscribeActionSuccess}' },
  { file: R + 'app/orgs/[id]/apps/+page.svelte', marker: '{deleteActionSuccess}' },
  { file: R + 'app/orgs/[id]/boot-prompt-signing/+page.svelte', marker: 'org.signing.stale', occurrence: 1, sharedGuard: "sits in the final else of the page's hidden/ok/failed chain, which holds before any action (outcome is null)" },
  { file: R + 'app/orgs/[id]/exchange/[connectionId]/+page.svelte', marker: '{replyActionSuccess}' },
  { file: R + 'app/orgs/[id]/exchange/[connectionId]/+page.svelte', marker: '{moveActionSuccess}' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: '{githubInstallationActionSuccess}' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: '{githubAppActionSuccess}' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: '{unlinkGithubActionSuccess}' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: 'Hadron GitHub App installed and linked' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: 'Microsoft Exchange connected successfully.' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: '{deleteExchangeConnectionActionSuccess}' },
  { file: R + 'app/orgs/[id]/integrations/+page.svelte', marker: '{testExchangeConnectionActionSuccess}' },
  { file: R + 'app/orgs/[id]/members/+page.svelte', marker: '{updateActionSuccess ?? removeActionSuccess}' },
  { file: R + 'app/orgs/[id]/memories/+page.svelte', marker: '{deleteActionSuccess ?? syncAllActionSuccess' },
  { file: R + 'app/workers/[id]/ChangeWorkerAgent.svelte', marker: 'data-testid="change-agent-done"' },
  { file: R + 'app/workers/[id]/WorkerLeaveAlone.svelte', marker: 'worker.leave-alone.unconfirmed' },
  { file: R + 'app/workers/[id]/WorkerLeaveAlone.svelte', marker: '{feedback.text}', occurrence: 1 },
  { file: R + 'contact/+page.svelte', marker: '{successMessage}' },
  { file: R + 'invite/[token]/+page.svelte', marker: '{emailSentMessage}' },
  { file: R + 'signin/+page.svelte', marker: '{successMessage}' },
  { file: R + 'signup/+page.svelte', marker: '{successMessage}' },
  { file: 'src/lib/components/AgentInheritanceSettings.svelte', marker: 'agent.parent.unsaved-replace' },
  { file: 'src/lib/components/AgentInheritanceSettings.svelte', marker: 'agent.parent.unsaved-set' },
  { file: 'src/lib/components/WorkerDeleteDialog.svelte', marker: 'app.staff.delete.pending' },
  { file: 'src/lib/components/agent-tasks/TaskFindings.svelte', marker: "{#if saving}<p class=", sharedGuard: "inside the disposition form, keyed by the finding being edited (`editing.id`); the form is open, and so the region mounted, before Save is pressed, so Saving… changes content in an existing region" },
  { file: 'src/lib/components/agent-tasks/TaskPlanning.svelte', marker: "t('app.tasks.saving'" },
];

type Ast = { type: string; name?: string; start: number; end: number; data?: string; test?: { start: number; end: number }; fragment?: { nodes: Ast[] }; [k: string]: unknown };
const GATES = new Set(['IfBlock', 'AwaitBlock', 'KeyBlock']); // an {#each} is a list of rows, not a condition on the result
const identifiers = (code: string) => new Set((code.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((w) => !['page', 'url', 'searchParams', 'get', 'data', 'form', 'null', 'undefined', 'true', 'false'].includes(w)));

/** Every LiveRegion element in the page: its non-blank children and the control-flow blocks around it. */
function liveRegions(src: string): { start: number; end: number; kids: Ast[]; gates: Ast[] }[] {
  const root = parse(src, { modern: true }) as unknown as { fragment: { nodes: Ast[] } };
  const out: { start: number; end: number; kids: Ast[]; gates: Ast[] }[] = [];
  const walk = (n: unknown, gates: Ast[]) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, gates));
    const node = n as Ast;
    if (node.type === 'Component' && node.name === 'LiveRegion') {
      const kids = (node.fragment?.nodes ?? []).filter((k) => !(k.type === 'Text' && !String(k.data ?? '').trim()) && k.type !== 'Comment');
      out.push({ start: node.start, end: node.end, kids, gates });
    }
    const next = GATES.has(node.type) ? [...gates, node] : gates;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, next);
  };
  walk(root.fragment, []);
  return out;
}

/**
 * The enclosing LiveRegion of `marker` is the persistent wrapper: its only child is an {#if}, AND it is not
 * itself mounted by a condition that turns true with the result. An ancestor `{#if}` (or each/await/key) whose
 * test shares an identifier with the region's own inner test is that defect: the region would be inserted
 * already populated. A static ancestor guard (`{#if canTransfer}`) is fine.
 */
export function markerIsInPersistentRegion(src: string, marker: string, nth = 0, sharedGuardReason = ''): boolean {
  // blank out HTML comments (keeping offsets) so a marker in a comment is not a site
  const code0 = src.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  let at = -1;
  for (let i = 0; i <= nth; i++) at = code0.indexOf(marker, at + 1);
  if (at < 0) return false;
  const region = liveRegions(src).find((r) => at >= r.start && at < r.end && r.kids.length === 1 && r.kids[0].type === 'IfBlock');
  if (!region) return false;
  const inner = region.kids[0];
  // the marker must be inside the {#if}, not in the wrapper's attributes
  if (at < inner.start || at >= inner.end) return false;
  const own = identifiers(inner.test ? src.slice(inner.test.start, inner.test.end) : '');
  // a nested role="status" would be the conditional status element again, inside the region
  if (/role=(["'])status\1/.test(src.slice(region.start, region.end))) return false;
  for (const g of region.gates) {
    // {#key} remounts its content when the value changes and {#await} mounts on settle: never a stable parent
    if ((g.type === 'KeyBlock' || g.type === 'AwaitBlock') && sharedGuardReason.length < 20) return false;
    const code = g.test ? src.slice(g.test.start, g.test.end) : src.slice(g.start, g.start + 200).split('}')[0];
    for (const id of identifiers(code)) if (own.has(id) && sharedGuardReason.length < 20) return false;
  }
  return true;
}

describe('portal#2375: route-page action results sit in a persistent LiveRegion', () => {
  it('recognises the right shape and the wrong one', () => {
    const imp = "<script>import LiveRegion from '$lib/components/LiveRegion.svelte';</script>";
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>`, 'MARK')).toBe(true);
    expect(markerIsInPersistentRegion(`${imp}{#if a}<LiveRegion><p>MARK</p></LiveRegion>{/if}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>MARK</p>{/if}<b>x</b></LiveRegion>`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}{#if a}<p role="status">MARK</p>{/if}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>x</p>{/if}</LiveRegion><p>MARK</p>`, 'MARK')).toBe(false);
    // the whole region mounted by the result's own condition is the original defect (George, #2382)
    expect(markerIsInPersistentRegion(`${imp}{#if a}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}{#if a && !b}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}`, 'MARK')).toBe(false);
    // the same wrapper remounted by a {#key}, or a status role nested inside it, or a marker only in a comment (Beckett, #2382)
    expect(markerIsInPersistentRegion(`${imp}{#key n}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/key}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p role="status">MARK</p>{/if}</LiveRegion>`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion data-x="MARK">{#if a}<p>y</p>{/if}</LiveRegion>`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<!-- MARK --><LiveRegion>{#if a}<p>y</p>{/if}</LiveRegion>`, 'MARK')).toBe(false);
    // a reviewed shared guard (with a reason) is allowed; one without is not
    expect(markerIsInPersistentRegion(`${imp}{#if a !== 'x'}<LiveRegion>{#if a === 'y'}<p>MARK</p>{/if}</LiveRegion>{/if}`, 'MARK', 0, 'true before the action: a is null at load')).toBe(true);
    expect(markerIsInPersistentRegion(`${imp}{#if a !== 'x'}<LiveRegion>{#if a === 'y'}<p>MARK</p>{/if}</LiveRegion>{/if}`, 'MARK', 0, 'short')).toBe(false);
    // a guard on something else is not the result's condition
    expect(markerIsInPersistentRegion(`${imp}{#if canEdit}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>{/if}`, 'MARK')).toBe(true);
  });

  it.each(SITES.map((s) => [s.file.replace(/^src\//, ''), s.marker, s] as const))('%s: %s', (_f, _m, s) => {
    const src = readFileSync(join(process.cwd(), s.file), 'utf8');
    expect(src.includes(s.marker), `marker not found in ${s.file}`).toBe(true);
    expect(markerIsInPersistentRegion(src, s.marker, s.occurrence ?? 0, s.sharedGuard)).toBe(true);
  });

  it('names every converted site once (44)', () => {
    expect(SITES.length).toBe(44);
    expect(new Set(SITES.map((s) => s.file + '\0' + s.marker)).size).toBe(44);
  });
});
