/**
 * portal#1403 — task-board search copy and live announcements (follow-up to
 * #1400/#1401, optional P3s). Pins: a grammatical loaded-count, ONE coherent
 * live region for count + cap + empty explanation, no-match copy that names the
 * active status scope and the escape, a cap notice that fits an absent search,
 * and a Clear that stays when no search is active. Count stays loaded-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const row = (i: number) => ({
  id: `t${i}`, title: `Task ${i}`, parentTaskId: null, status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: { id: 'u1', kind: 'USER', name: 'Test', urn: null }, assignee: null,
  startBy: null, createdAt: '2026-10-29T00:00:00Z', updatedAt: null, tags: [],
});
const data = (over: Record<string, unknown> = {}, tasks = 3, capped = false) => ({
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'ended', text: 'needle', boardLimit: 200, loadedAt: '2026-10-29T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped, tasks: Array.from({ length: tasks }, (_, i) => row(i)) } }, ...over,
});
async function mount(over = {}, tasks = 3, capped = false) {
  const m = mountComponent(Harness as never, { initial: data(over, tasks, capped) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const live = (m: Mounted<any>) => [...m.target.querySelectorAll('[role=status]')];
const text = (m: Mounted<any>) => m.target.textContent ?? '';

describe('loaded-count wording (portal#1403)', () => {
  it.each([[0, 'Tasks shown: 0'], [1, 'Tasks shown: 1'], [3, 'Tasks shown: 3']])('%i row(s) read "%s", never "1 tasks shown"', async (n, copy) => {
    const m = await mount({}, n);
    expect(text(m)).toContain(copy);
    expect(text(m)).not.toMatch(/\d+ tasks shown/);
  });
  it('stays a loaded count, never an exact total, when capped', async () => {
    const m = await mount({}, 200, true);
    expect(text(m)).toContain('Tasks shown: 200');
    expect(live(m)[0].textContent).not.toMatch(/\bof \d+|total/i);
  });
});

describe('one coherent live region (portal#1403)', () => {
  it('count, cap notice and empty explanation share ONE status region (empty + capped)', async () => {
    const m = await mount({}, 0, true);
    expect(live(m)).toHaveLength(1);
    const t = live(m)[0].textContent!;
    expect(t).toContain('Tasks shown: 0');
    expect(t).toContain('No matching tasks');
    expect(t).toContain('There may be more');
  });
  it('a plain loaded board announces through one region too', async () => {
    const m = await mount({}, 3);
    expect(live(m)).toHaveLength(1);
    expect(live(m)[0].textContent).toContain('Tasks shown: 3');
  });
  it('the empty explanation is still visible and findable by its marker', async () => {
    const m = await mount({}, 0);
    expect(m.target.querySelector('[data-empty]')?.textContent).toContain('No matching tasks');
  });
});

describe('no-match copy names the scope and the way out (portal#1403)', () => {
  it.each([['ended', 'Ended'], ['all', 'All'], ['backlog', 'Backlog']])('search on %s names "%s", Clear and the status', async (filter, label) => {
    const m = await mount({ filter }, 0);
    const copy = m.target.querySelector('[data-empty]')!.textContent!;
    expect(copy).toContain(label);
    expect(copy).toMatch(/clear the search/i);
    expect(copy).toMatch(/change the status/i);
  });
  it('writes the search text nowhere in that copy (no echo, no injection surface)', async () => {
    const m = await mount({ text: '<img src=x onerror=alert(1)>' }, 0);
    expect(m.target.querySelector('[data-empty]')!.textContent).not.toContain('onerror');
    expect(m.target.querySelector('[data-empty] img')).toBeNull();
  });
  it('keeps the no-search empty copy and the narrow-filter copy as they were', async () => {
    expect((await mount({ text: '', filter: 'active' }, 0)).target.querySelector('[data-empty]')!.textContent).toContain('No active tasks.');
    expect((await mount({ text: '', tags: ['x'] }, 0)).target.querySelector('[data-empty]')!.textContent).toContain('No tasks match these filters.');
  });
});

describe('cap notice fits the state (portal#1403)', () => {
  it('with a search it says narrow the search', async () => {
    const m = await mount({}, 200, true);
    expect(text(m)).toContain('There may be more; narrow the search.');
  });
  it('with no search it points at the status filter or a search', async () => {
    const m = await mount({ text: '' }, 200, true);
    expect(text(m)).toContain('There may be more; narrow the status filter or search.');
    expect(text(m)).not.toContain('narrow the search.');
  });
});

describe('Clear with no active search (portal#1403)', () => {
  it('stays: it still resets the draft and the narrow filters, so it is a needed escape', async () => {
    const m = await mount({ text: '' }, 3);
    const clear = [...m.target.querySelectorAll('a')].find((a) => a.textContent === 'Clear')!;
    expect(clear).toBeTruthy();
    const url = new URL(clear.href);
    expect(url.searchParams.get('text')).toBeNull();
    expect(url.searchParams.get('tags')).toBeNull();
    expect(url.searchParams.get('overdue')).toBeNull();
  });
});
