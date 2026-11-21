import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';

/**
 * portal#2378, slice 5 of #2344 — the sites that DROPPED `role="status"` instead of gaining a wrapper.
 *
 * Text that is present when the page loads (or is a state the loader decided) is not a status change:
 * a live region announces CHANGES inside a region that already exists, so a `role="status"` on content
 * that was always there announces nothing and only adds noise. Each entry below names one dropped site
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
  { file: 'src/routes/app/apps/[appId]/tasks/+page.svelte', marker: 'overdue-dropped', why: 'the dropped-filter note is decided by the URL the page loaded' },
  { file: 'src/routes/app/apps/[appId]/tasks/+page.svelte', marker: 'unresolved-dropped', why: 'the dropped-filter note is decided by the URL the page loaded' },
  { file: 'src/routes/app/apps/[appId]/tickers/+page.svelte', marker: 'tickers-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/apps/[appId]/tickers/[tickerId]/+page.svelte', marker: 'subscribers-empty', why: 'the rows are loader data' },
  { file: 'src/routes/app/memories/[id]/subscriptions/+page.svelte', marker: 'subscriptions.no-targets', why: 'the targets are loader data' },
  { file: 'src/routes/app/workers/[id]/+page.svelte', marker: 'worker.retired.notice', why: 'a static notice about the worker, present at load' },
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
