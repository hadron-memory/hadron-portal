import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';

/**
 * portal#2378, slice 5 of #2344 — the sites that DROPPED `role="status"` instead of gaining a wrapper.
 *
 * Text that is present when the page loads is not a status change: a live region announces CHANGES
 * inside a region that already exists, so a `role="status"` on content that was always there announces
 * nothing and only adds noise. Being loader-derived does NOT make a state static (#2383 BLIND P2): a
 * bucket change, filter or action on the page can flip it in place, so those converted instead (the
 * tasks board's dropped-filter notes, the worker page's retired notice). Each entry below names one dropped site
 * by a marker inside its element (an i18n key or a `data-testid`) and the reason it dropped.
 *
 * The pin: the element holding the marker EXISTS in the template and carries no `role="status"`. It
 * fails against main, where each of these elements carried the role. A marker that disappears fails
 * too, so a rename cannot turn this into a pin on nothing.
 *
 * Sites that CONVERTED to `LiveRegion` (user action, filter or search flips the state) are pinned by a
 * before/during/after test beside their component. SelectMemory's keepOpen note stays a status: its text
 * changes as the reader picks ("3 of 50 chosen."), and `reviewedNotDefects` keeps it counted.
 */
const DROPPED: Array<{ file: string; marker: string; why: string }> = [
  { file: 'src/routes/app/agents/[id]/BootPromptSource.svelte', marker: 'data-boot-outdated', why: 'the outdated notice is derived from the loaded compile lint' },
  { file: 'src/routes/app/agents/[id]/clone/+page.svelte', marker: 'agent.clone.no-targets', why: 'the targets are loader data' },
  { file: 'src/routes/app/apps/[appId]/AppMembersPanel.svelte', marker: 'app-members.add.no-roles', why: 'the offered roles are loader data' },
  { file: 'src/routes/app/apps/[appId]/automations/+page.svelte', marker: 'automations-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/apps/[appId]/grants/+page.svelte', marker: 'grants.impersonating', why: 'a static note about the viewer, not a result' },
  { file: 'src/routes/app/apps/[appId]/register/+page.svelte', marker: 'action-register.no-agents', why: 'the options are loader data' },
  { file: 'src/routes/app/apps/[appId]/stops/+page.svelte', marker: 'stops-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/apps/[appId]/tickers/+page.svelte', marker: 'tickers-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/apps/[appId]/tickers/[tickerId]/+page.svelte', marker: 'subscribers-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/memories/[id]/subscriptions/+page.svelte', marker: 'subscriptions.no-targets', why: 'the targets are loader data' },
  { file: 'src/lib/components/action-register/ActionRegisterList.svelte', marker: 'register-empty', why: 'the page entries are loader data' },
  { file: 'src/lib/components/agent-tasks/TasksComposition.svelte', marker: 'app.tasks.roster.empty', why: 'the composition is loader data' },
  { file: 'src/lib/components/agent-tasks/TasksRoster.svelte', marker: 'app.tasks.roster.empty', why: 'the roster is loader data' },
  { file: 'src/lib/components/tickers/AgentTickerTemplatesPanel.svelte', marker: 'agent-ticker-templates-empty', why: 'the templates are loader data' },
  { file: 'src/lib/components/tickers/WakeUpsPanel.svelte', marker: 'wake-subscriptions-empty', why: 'the subscriptions are loader data' }
];

type Attr = { type: string; name?: string; value?: true | { type: string; data?: string }[] };
type N = { type: string; start: number; end: number; attributes?: Attr[]; [k: string]: unknown };

const isStatus = (n: N) =>
  (n.attributes ?? []).some((a) => a.type === 'Attribute' && a.name === 'role' && Array.isArray(a.value) && a.value.length === 1 && a.value[0].type === 'Text' && a.value[0].data?.trim() === 'status');

/** Source slices of every element, split into those carrying role="status" and the rest. */
function elements(src: string) {
  const ast = parse(src, { modern: true }) as unknown as { fragment: unknown };
  const all: string[] = [];
  const status: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as N;
    if (node.type === 'RegularElement' || node.type === 'Component') {
      (isStatus(node) ? status : all).push(src.slice(node.start, node.end));
      if (isStatus(node)) all.push(src.slice(node.start, node.end));
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(ast.fragment);
  return { all, status };
}

describe('portal#2378: sites that dropped role="status" (present at load, not a status change)', () => {
  it('recognises a status element and a plain one', () => {
    const e = elements('{#if a}<p role="status" data-x>hello</p>{/if}{#if b}<p data-y>hi</p>{/if}');
    expect(e.status.some((s) => s.includes('data-x'))).toBe(true);
    expect(e.status.some((s) => s.includes('data-y'))).toBe(false);
    expect(e.all.some((s) => s.includes('data-y'))).toBe(true);
  });

  for (const { file, marker, why } of DROPPED) {
    it(`${file} — ${marker}: ${why}`, () => {
      const { all, status } = elements(readFileSync(file, 'utf8'));
      expect(all.some((s) => s.includes(marker)), `the element holding "${marker}" is still in the template`).toBe(true);
      expect(status.filter((s) => s.includes(marker)), `"${marker}" must not sit in a role="status" element`).toEqual([]);
    });
  }
});

/**
 * portal#2378, Jane's P2 on c8cb33ae: in Tailwind v4 `space-y-*` puts its gap on `:not(:last-child)`, so an
 * IDLE (empty) region that is the last child of a `space-y` parent makes the sibling before it gain one gap
 * (a 12px taller dialog), and `empty:m-0` cannot undo that. Each converted region below therefore sits
 * BEFORE an element or component that always renders in the same branch, never last.
 * The vector-health region is not listed: it is the last child of the check `<form>`, which is not a
 * `space-y` parent, and its box carries its own `mt-3`.
 */
const NEVER_TRAILING: Array<{ file: string; testid: string }> = [
  { file: 'src/lib/components/SelectNode.svelte', testid: 'node-picker-empty' },
  { file: 'src/lib/components/agent-tasks/SelectTask.svelte', testid: 'task-picker-empty' },
  { file: 'src/lib/components/agent-tasks/SelectTask.svelte', testid: 'task-picker-exact-empty' },
  { file: 'src/lib/components/LazyNodesBrowser.svelte', testid: 'nodes-tab-none' },
  { file: 'src/routes/app/orgs/[id]/runs/+page.svelte', testid: 'org-runs-filtered-empty' }
];

type Frag = { nodes: Array<N & { name?: string; data?: string }> };

/**
 * True when the region carrying `testid` is followed, in the SAME branch, by an element or component that
 * always renders. A following `{#if}`/`{#each}` does not count: when its condition is false (the idle,
 * pre-result state, which is exactly when the gap shows) the region is the last child.
 */
function hasFollowingLeaf(src: string, testid: string) {
  const ast = parse(src, { modern: true }) as unknown as { fragment: Frag };
  let verdict: boolean | null = null;
  const walk = (n: unknown, frag: Frag) => {
    if (!n || typeof n !== 'object' || verdict !== null) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, frag));
    const node = n as N & { name?: string; nodes?: Frag['nodes'] };
    const here: Frag = Array.isArray(node.nodes) ? (node as unknown as Frag) : frag;
    if (node.type === 'Component' && node.name === 'LiveRegion' && src.slice(node.start, node.end).includes(`"${testid}"`)) {
      const i = frag.nodes.findIndex((x) => x.start === node.start);
      verdict = i >= 0 && frag.nodes.slice(i + 1).some((x) => x.type === 'RegularElement' || x.type === 'Component');
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, here);
  };
  walk(ast.fragment, ast.fragment);
  if (verdict === null) throw new Error(`no LiveRegion with data-testid="${testid}"`);
  return verdict;
}

describe('portal#2378: a converted region is never the idle last child of its parent', () => {
  it('sees a trailing region and a non-trailing one', () => {
    expect(hasFollowingLeaf('<div class="space-y-3"><a/><LiveRegion data-testid="x">{#if a}<p/>{/if}</LiveRegion></div>', 'x')).toBe(false);
    expect(hasFollowingLeaf('<div class="space-y-3"><LiveRegion data-testid="x">{#if a}<p/>{/if}</LiveRegion><a/></div>', 'x')).toBe(true);
  });

  for (const { file, testid } of NEVER_TRAILING) {
    it(`${file} — ${testid} has a sibling after it`, () => {
      expect(hasFollowingLeaf(readFileSync(file, 'utf8'), testid)).toBe(true);
    });
  }
});
