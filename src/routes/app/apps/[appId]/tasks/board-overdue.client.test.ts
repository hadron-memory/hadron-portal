/**
 * portal#2244 (#2654 companion) — the board's overdue mark is the server's
 * `AgentTask.overdue` and nothing else: start-by OR finish-by passed, judged on
 * the server clock. The portal computes no rule of its own, so the browser
 * clock never shows (or hides) a mark the server did not set. Started tasks
 * past finish-by and pending tasks with no start-by are overdue too — neither
 * could be marked by the old local predicate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

/** A row exactly as the server returns it; only the fields under test vary. */
const task = (over: Record<string, unknown>) => ({
  id: 't1', handle: 'AT0.1', parentTaskId: null, title: 'Task', status: 'PENDING', queued: false,
  waitingOnChildren: false, priority: null, blocked: null, source: null,
  owner: { id: 'u', kind: 'USER', name: 'U', urn: null }, assignee: null,
  startBy: null, finishBy: null, overdue: false,
  createdAt: '2026-11-10T00:00:00Z', updatedAt: null, tags: [],
  ...over,
});
const data = (tasks: unknown[]) => ({
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'all', text: '', boardLimit: 200, loadedAt: '2026-11-18T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped: false, tasks } },
});
async function mount(tasks: unknown[]) {
  const m = mountComponent(Harness as never, { initial: data(tasks) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
/** One line per rendered task row, in DOM order. */
const rowLines = (m: Mounted<any>) => [...m.target.querySelectorAll('[data-testid=task-row], tbody tr')] as HTMLElement[];

describe('the overdue mark is the server overdue field', () => {
  it('marks a STARTED task past its finish-by (overdue true): red on the old predicate', async () => {
    const m = await mount([task({ status: 'STARTED', finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(rowLines(m)[0].textContent).toContain('overdue');
  });

  it('marks a pending task with no start-by whose finish-by passed', async () => {
    const m = await mount([task({ finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(rowLines(m)[0].textContent).toContain('overdue');
  });

  it('marks a task whose start-by is in the future by the browser clock when the server says overdue', async () => {
    const m = await mount([task({ startBy: '2099-01-01T00:00:00Z', overdue: true })]);
    expect(rowLines(m)[0].textContent).toContain('overdue');
  });

  it('shows no mark when the server says not overdue, however past the start-by looks locally', async () => {
    const m = await mount([task({ startBy: '2020-01-01T00:00:00Z', overdue: false })]);
    expect(rowLines(m)[0].textContent).not.toContain('overdue');
  });

  it('shows none on ended and backlog rows the server did not mark', async () => {
    const m = await mount([
      task({ id: 't2', status: 'FINISHED', finishBy: '2020-01-01T00:00:00Z', overdue: false }),
      task({ id: 't3', status: 'BACKLOG', startBy: '2020-01-01T00:00:00Z', overdue: false }),
    ]);
    for (const line of rowLines(m)) expect(line.textContent).not.toContain('overdue');
  });

  it('over one fixture set, the marks are exactly the rows the server marked', async () => {
    const m = await mount([
      task({ id: 'a', title: 'A overdue by finish', status: 'STARTED', finishBy: '2026-11-11T00:00:00Z', overdue: true }),
      task({ id: 'b', title: 'B overdue without start-by', finishBy: '2026-11-11T00:00:00Z', overdue: true }),
      task({ id: 'c', title: 'C locally past start-by', startBy: '2020-01-01T00:00:00Z', overdue: false }),
      task({ id: 'd', title: 'D nothing due' }),
    ]);
    const marked = rowLines(m).filter((line) => line.textContent!.includes('overdue'));
    expect(marked).toHaveLength(2);
    expect(marked.map((line) => line.textContent)).toEqual([
      expect.stringContaining('A overdue by finish'),
      expect.stringContaining('B overdue without start-by'),
    ]);
  });

  it('shows a Finish by column with the deadline', async () => {
    const m = await mount([task({ finishBy: '2026-11-20T12:00:00Z' })]);
    const head = [...m.target.querySelectorAll('th')].map((th) => th.textContent!.trim());
    expect(head.some((h) => h.startsWith('Finish by'))).toBe(true);
    expect(rowLines(m)[0].textContent).toContain('Nov 20');
  });
});
