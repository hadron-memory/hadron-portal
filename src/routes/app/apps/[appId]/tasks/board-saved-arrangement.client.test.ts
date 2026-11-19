/**
 * portal#2253 item 4 — a saved arrangement that predates a column must take
 * the new column at its default position, not at the far end of the table.
 *
 * table-core appends ids missing from a non-empty saved `columnOrder` after
 * the last saved column (getOrderColumnsFn), so a view saved before the
 * Finish by column existed (#2244) put Finish by behind even Updated — past
 * the fold at 1440, the exact clip the #2248 reorder fixed for fresh views.
 * The view layer now merges missing columns in at their default position and
 * persists the merge, so the saved view neither strands the column at the end
 * nor reads as permanently "modified" against the arrangement it now has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

const KEY = 'hadron:views:v1:app-tasks:board';
const ACTIVE_KEY = 'hadron:views:v1:active:app-tasks:board';

/** A saved arrangement from before Finish by existed: the user dragged the
 * people columns ahead of the deadlines and saved — so the stored order is
 * non-empty (a dragged order) and cannot name `finishBy`. */
const pre2244Order = ['status', 'title', 'priority', 'owner', 'assignee', 'subtasks', 'startBy', 'updated'];
const pre2244View = {
  sorting: [{ id: 'updated', desc: true }],
  columnFilters: [],
  globalFilter: '',
  columnVisibility: { created: false, tags: false, id: false },
  columnOrder: pre2244Order,
  columnSizing: {},
  pagination: { pageIndex: 0, pageSize: 25 },
};

function seedSavedView(view: unknown, id = 'v1') {
  localStorage.setItem(KEY, JSON.stringify([{
    id, listKey: 'app-tasks:board', name: 'Pre-2248 layout', view,
    isDefault: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  }]));
  localStorage.setItem(ACTIVE_KEY, id);
}

const mounted: Mounted<any>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  localStorage.removeItem(KEY);
  localStorage.removeItem(ACTIVE_KEY);
});

const task = (over: Record<string, unknown>) => ({
  id: 't1', handle: 'AT0.1', parentTaskId: null, title: 'Task', status: 'PENDING', queued: false,
  waitingOnChildren: false, priority: null, blocked: null, source: null,
  owner: { id: 'u', kind: 'USER', name: 'U', urn: null }, assignee: null,
  startBy: '2026-11-20T09:00:00Z', finishBy: '2026-11-21T09:00:00Z', overdue: false,
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

const HEADERS = ['Status', 'Task', 'Priority', 'Start by', 'Finish by', 'Owner', 'Assignee', 'Subtasks', 'Updated'] as const;

/** Header name → th index, scoped to the one header row (portal#2253 item 3). */
function headerIndexes(m: Mounted<any>): Partial<Record<typeof HEADERS[number], number>> {
  const ths = [...m.target.querySelectorAll('thead tr:last-child th')] as HTMLElement[];
  const idx: Partial<Record<typeof HEADERS[number], number>> = {};
  ths.forEach((th, i) => {
    const text = th.textContent!.trim();
    const name = HEADERS.find((h) => text.startsWith(h));
    if (name) idx[name] = i;
  });
  return idx;
}

/** The board's saved-view init is async (onMount → store reads → apply), and
 * the pre-init DOM already renders headers in the natural order — so presence
 * of a header proves nothing. Wait for init to have RUN: the saved view's tab
 * appears in the strip, and (for a dragged order) the saved arrangement is
 * visible in the DOM. */
async function untilApplied(m: Mounted<any>, applied: (idx: Partial<Record<typeof HEADERS[number], number>>) => boolean, rounds = 50) {
  for (let i = 0; i < rounds; i++) {
    const tabbed = m.target.textContent?.includes('Pre-2248 layout') ?? false;
    if (tabbed && applied(headerIndexes(m))) return;
    await tick(2);
  }
  // Fail HERE with a message that names the wait (portal#2274 P3): a silent
  // timeout left the following expect to fail on a natural-order DOM, which
  // reads as a merge bug instead of "init never ran".
  const tabbed = m.target.textContent?.includes('Pre-2248 layout') ?? false;
  throw new Error(
    tabbed
      ? `saved view applied but the expected arrangement never appeared within ${rounds} rounds — headers: ${JSON.stringify(headerOrder(m))}`
      : `saved-view init never ran within ${rounds} rounds — the saved view's tab never appeared in the strip`,
  );
}

/** Visible header names in DOM order — the assertion vocabulary. */
function headerOrder(m: Mounted<any>): string[] {
  const ths = [...m.target.querySelectorAll('thead tr:last-child th')] as HTMLElement[];
  return ths
    .map((th) => HEADERS.find((h) => th.textContent!.trim().startsWith(h)))
    .filter((h): h is typeof HEADERS[number] => Boolean(h));
}

function storedOrder(): string[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { view: { columnOrder: string[] } }[];
  return parsed[0]?.view?.columnOrder ?? [];
}

describe('a saved arrangement predating a column (portal#2253 item 4)', () => {
  it('takes the new Finish by column at its default position, not the far end', async () => {
    seedSavedView(pre2244View);
    const m = await mount([task({})]);
    // The saved (dragged) order is applied when the people columns sit ahead of
    // Start by — the pre-init natural order has them after.
    await untilApplied(m, (idx) => (idx['Owner'] ?? -1) < (idx['Start by'] ?? -1));
    expect(headerOrder(m)).toEqual([
      'Status', 'Task', 'Priority', 'Owner', 'Assignee', 'Subtasks', 'Start by', 'Finish by', 'Updated',
    ]);
  });

  it('persists the merge, so a reload keeps the column and the view is not permanently modified', async () => {
    seedSavedView(pre2244View);
    const m = await mount([task({})]);
    await untilApplied(m, (idx) => (idx['Owner'] ?? -1) < (idx['Start by'] ?? -1));
    expect(storedOrder()).toContain('finishBy');
    expect(storedOrder().indexOf('finishBy')).toBe(storedOrder().indexOf('startBy') + 1);
    m.unmount();
    // A reload re-resolves from storage: the stored arrangement now names the
    // column, so it applies as-is with no second migration write.
    const before = storedOrder();
    const m2 = await mount([task({})]);
    await untilApplied(m2, (idx) => (idx['Owner'] ?? -1) < (idx['Start by'] ?? -1));
    expect(headerOrder(m2)).toEqual([
      'Status', 'Task', 'Priority', 'Owner', 'Assignee', 'Subtasks', 'Start by', 'Finish by', 'Updated',
    ]);
    expect(storedOrder()).toEqual(before);
  });

  it('keeps an undragged (empty) saved order empty — natural order self-migrates', async () => {
    seedSavedView({ ...pre2244View, columnOrder: [] });
    const m = await mount([task({})]);
    // The tab strip naming the view is the init-ran signal; the empty order
    // leaves the natural arrangement (deadlines before the people columns).
    await untilApplied(m, () => true);
    expect(headerOrder(m)).toEqual([
      'Status', 'Task', 'Priority', 'Start by', 'Finish by', 'Owner', 'Assignee', 'Subtasks', 'Updated',
    ]);
    expect(storedOrder()).toEqual([]);
  });

  it('applies the merged arrangement even when the persist fails (quota-full storage) — portal#2274 P2', async () => {
    // Quota-full storage: reads work, every write throws. jsdom's localStorage
    // setItem cannot be shadowed by assignment (the override silently no-ops),
    // so the whole global is stubbed — the view store resolves
    // globalThis.localStorage on every access and picks the stub up.
    const seeded = new Map<string, string>([
      [KEY, JSON.stringify([{
        id: 'v1', listKey: 'app-tasks:board', name: 'Pre-2248 layout', view: pre2244View,
        isDefault: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      }])],
      [ACTIVE_KEY, 'v1'],
    ]);
    const quotaStorage = {
      length: 0,
      clear: () => seeded.clear(),
      getItem: (k: string) => seeded.get(k) ?? null,
      key: () => null,
      removeItem: (k: string) => void seeded.delete(k),
      setItem: () => { throw new DOMException('quota exceeded', 'QuotaExceededError'); },
    } as unknown as Storage;
    vi.stubGlobal('localStorage', quotaStorage);
    try {
      const m = await mount([task({})]);
      await untilApplied(m, (idx) => (idx['Owner'] ?? -1) < (idx['Start by'] ?? -1));
      expect(headerOrder(m)).toEqual([
        'Status', 'Task', 'Priority', 'Owner', 'Assignee', 'Subtasks', 'Start by', 'Finish by', 'Updated',
      ]);
      // The stub keeps the pre-merge order: no write could land, so the next
      // mount re-attempts the merge.
      expect(JSON.parse(seeded.get(KEY)!)[0].view.columnOrder).toEqual(pre2244Order);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
