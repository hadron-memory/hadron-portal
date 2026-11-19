/**
 * portal#2244 (hadron-server#4220, #2654) — the board's overdue mark is the
 * server's `AgentTask.overdue` and nothing else: a pending, not-started task
 * past its start-by, or a pending-or-started task past its finish-by and not
 * ended; backlog never — all judged on the server clock. The portal computes
 * no rule of its own, so the browser clock never shows (or hides) a mark the
 * server did not set. Started tasks past finish-by and pending tasks with no
 * start-by are overdue too — neither could be marked by the old local
 * predicate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

// portal#2248 review (Gil P3 6): fmtRunTime renders with the runtime timezone,
// so pin it before anything formats — 'Nov 20' must be the same date wherever
// the suite runs.
process.env.TZ = 'UTC';

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
/**
 * portal#2248 review (Gil P2 2): the mark is asserted by its hook
 * (`data-testid="overdue-mark"`), never by row text — a title containing
 * "overdue" made the positive half of a text-match test unable to fail.
 */
const markIn = (el: Element | null | undefined) => el?.querySelector('[data-testid=overdue-mark]') ?? null;

describe('the overdue mark is the server overdue field', () => {
  it('marks a STARTED task past its finish-by (overdue true) — the old predicate left it unmarked', async () => {
    const m = await mount([task({ status: 'STARTED', finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(markIn(rowLines(m)[0])).not.toBeNull();
  });

  it('marks a pending task with no start-by whose finish-by passed', async () => {
    const m = await mount([task({ finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(markIn(rowLines(m)[0])).not.toBeNull();
  });

  it('marks a task whose start-by is in the future by the browser clock when the server says overdue', async () => {
    const m = await mount([task({ startBy: '2099-01-01T00:00:00Z', overdue: true })]);
    expect(markIn(rowLines(m)[0])).not.toBeNull();
  });

  it('shows no mark when the server says not overdue, however past the start-by looks locally', async () => {
    const m = await mount([task({ startBy: '2020-01-01T00:00:00Z', overdue: false })]);
    expect(markIn(rowLines(m)[0])).toBeNull();
  });

  it('shows none on ended and backlog rows the server did not mark', async () => {
    const m = await mount([
      task({ id: 't2', status: 'FINISHED', finishBy: '2020-01-01T00:00:00Z', overdue: false }),
      task({ id: 't3', status: 'BACKLOG', startBy: '2020-01-01T00:00:00Z', overdue: false }),
    ]);
    for (const line of rowLines(m)) expect(markIn(line)).toBeNull();
  });

  it('over one fixture set, the marks are exactly the rows the server marked', async () => {
    const m = await mount([
      task({ id: 'a', title: 'A late by finish', status: 'STARTED', finishBy: '2026-11-11T00:00:00Z', overdue: true }),
      task({ id: 'b', title: 'B no start date, finish passed', finishBy: '2026-11-11T00:00:00Z', overdue: true }),
      task({ id: 'c', title: 'C locally past start-by', startBy: '2020-01-01T00:00:00Z', overdue: false }),
      task({ id: 'd', title: 'D nothing due' }),
    ]);
    const marked = rowLines(m).filter((line) => markIn(line));
    expect(marked).toHaveLength(2);
    expect(marked.map((line) => line.textContent)).toEqual([
      expect.stringContaining('A late by finish'),
      expect.stringContaining('B no start date, finish passed'),
    ]);
  });

  it('shows a Finish by column with the deadline', async () => {
    const m = await mount([task({ finishBy: '2026-11-20T12:00:00Z' })]);
    const head = [...m.target.querySelectorAll('th')].map((th) => th.textContent!.trim());
    expect(head.some((h) => h.startsWith('Finish by'))).toBe(true);
    expect(rowLines(m)[0].textContent).toContain('Nov 20');
  });
});

describe('the mark is task-level, in the Status cell (portal#2248 review: Jonas P2 1, Uma P2)', () => {
  /**
   * portal#2248 review — the server boolean does not say WHICH deadline
   * passed, so a mark attached to a date cell is a claim the UI cannot back:
   * a finish-by-only overdue read as "Start by: — overdue", pointing at the
   * one arm a started task can never be on. The mark belongs beside the
   * status pill; the two date columns say which time passed.
   */
  const cellUnder = (m: Mounted<any>, headerPrefix: string) => {
    const ths = [...m.target.querySelectorAll('th')] as HTMLElement[];
    const idx = ths.findIndex((th) => th.textContent!.trim().startsWith(headerPrefix));
    expect(idx).toBeGreaterThanOrEqual(0);
    return rowLines(m)[0].querySelectorAll('td')[idx] as HTMLElement;
  };

  it('a finish-by-only overdue never reads "— overdue" under Start by; the Status cell carries the mark', async () => {
    const m = await mount([task({ finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(markIn(cellUnder(m, 'Start by'))).toBeNull();
    expect(markIn(cellUnder(m, 'Status'))).not.toBeNull();
  });

  it('an overdue with a start-by keeps Start by to the date alone; the mark sits with the status pill', async () => {
    const m = await mount([task({ startBy: '2026-11-10T00:00:00Z', finishBy: '2026-11-11T00:00:00Z', overdue: true })]);
    expect(cellUnder(m, 'Start by').textContent).toContain('Nov 10');
    expect(markIn(cellUnder(m, 'Start by'))).toBeNull();
    expect(markIn(cellUnder(m, 'Status'))).not.toBeNull();
  });

  it('both date columns are wide enough for their longest value at 1440 (review P3: clipping)', async () => {
    const m = await mount([task({ startBy: '2026-11-20T09:00:00Z', finishBy: '2026-11-21T09:00:00Z' })]);
    const width = (prefix: string) => {
      const th = ([...m.target.querySelectorAll('th')] as HTMLElement[]).find((t) => t.textContent!.trim().startsWith(prefix))!;
      return th.getAttribute('style') ?? '';
    };
    expect(width('Start by')).toContain('--col-w: 200px');
    expect(width('Finish by')).toContain('--col-w: 200px');
  });
});
