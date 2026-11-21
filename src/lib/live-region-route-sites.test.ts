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
type Site = { file: string; marker: string; nth?: number };
const R = 'src/routes/';
const SITES: Site[] = [
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
  { file: R + 'app/orgs/[id]/+page.svelte', marker: 'org.signing.switched-off' },
  { file: R + 'app/orgs/[id]/agents/+page.svelte', marker: '{subscribeActionSuccess}' },
  { file: R + 'app/orgs/[id]/agents/+page.svelte', marker: '{unsubscribeActionSuccess}' },
  { file: R + 'app/orgs/[id]/apps/+page.svelte', marker: '{deleteActionSuccess}' },
  { file: R + 'app/orgs/[id]/boot-prompt-signing/+page.svelte', marker: 'org.signing.stale', nth: 1 },
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
  { file: R + 'app/workers/[id]/WorkerLeaveAlone.svelte', marker: 'emerald-600' },
  { file: R + 'contact/+page.svelte', marker: '{successMessage}' },
  { file: R + 'invite/[token]/+page.svelte', marker: '{emailSentMessage}' },
  { file: R + 'signin/+page.svelte', marker: '{successMessage}' },
  { file: R + 'signup/+page.svelte', marker: '{successMessage}' },
  { file: 'src/lib/components/AgentInheritanceSettings.svelte', marker: 'agent.parent.unsaved-replace' },
  { file: 'src/lib/components/AgentInheritanceSettings.svelte', marker: 'agent.parent.unsaved-set' },
  { file: 'src/lib/components/WorkerDeleteDialog.svelte', marker: 'app.staff.delete.pending' },
  { file: 'src/lib/components/agent-tasks/TaskFindings.svelte', marker: "{#if saving}<p class=" },
  { file: 'src/lib/components/agent-tasks/TaskPlanning.svelte', marker: "t('app.tasks.saving'" },
];

type Ast = { type: string; name?: string; start: number; end: number; fragment?: { nodes: Ast[] }; consequent?: { nodes: Ast[] }; alternate?: { nodes: Ast[] } | null; [k: string]: unknown };

/** Every LiveRegion element in the page, with its non-blank children. */
function liveRegions(src: string): { start: number; end: number; kids: Ast[] }[] {
  const root = parse(src, { modern: true }) as unknown as { fragment: { nodes: Ast[] } };
  const out: { start: number; end: number; kids: Ast[] }[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Ast;
    if (node.type === 'Component' && node.name === 'LiveRegion') {
      const kids = (node.fragment?.nodes ?? []).filter((k) => !(k.type === 'Text' && !String(k.data ?? '').trim()) && k.type !== 'Comment');
      out.push({ start: node.start, end: node.end, kids });
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(root.fragment);
  return out;
}

/** The enclosing LiveRegion of `marker` is the persistent wrapper and its only child is an {#if}. */
export function markerIsInPersistentRegion(src: string, marker: string, nth = 0): boolean {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = src.indexOf(marker, at + 1);
  if (at < 0) return false;
  return liveRegions(src).some((r) => at >= r.start && at < r.end && r.kids.length === 1 && r.kids[0].type === 'IfBlock');
}

describe('portal#2375: route-page action results sit in a persistent LiveRegion', () => {
  it('recognises the right shape and the wrong one', () => {
    const imp = "<script>import LiveRegion from '$lib/components/LiveRegion.svelte';</script>";
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>MARK</p>{/if}</LiveRegion>`, 'MARK')).toBe(true);
    expect(markerIsInPersistentRegion(`${imp}{#if a}<LiveRegion><p>MARK</p></LiveRegion>{/if}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>MARK</p>{/if}<b>x</b></LiveRegion>`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}{#if a}<p role="status">MARK</p>{/if}`, 'MARK')).toBe(false);
    expect(markerIsInPersistentRegion(`${imp}<LiveRegion>{#if a}<p>x</p>{/if}</LiveRegion><p>MARK</p>`, 'MARK')).toBe(false);
  });

  it.each(SITES.map((s) => [s.file.replace(/^src\//, ''), s.marker, s] as const))('%s: %s', (_f, _m, s) => {
    const src = readFileSync(join(process.cwd(), s.file), 'utf8');
    expect(src.includes(s.marker), `marker not found in ${s.file}`).toBe(true);
    expect(markerIsInPersistentRegion(src, s.marker, s.nth ?? 0)).toBe(true);
  });

  it('names every converted site once (44)', () => {
    expect(SITES.length).toBe(44);
    expect(new Set(SITES.map((s) => s.file + '\0' + s.marker)).size).toBe(44);
  });
});
