import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { firstPaint } from '$lib/test/firstPaint';
import { answerSnippet } from '$lib/test/answerSnippet.svelte';
import InstallCustomisation from './InstallCustomisation.svelte';
import TaskActionBar from './agent-tasks/TaskActionBar.svelte';
import LazySection from './agent-tasks/LazySection.svelte';

/**
 * portal#2388 (Refs #2344, #2377): a status region that is inserted ALREADY holding its text may not be
 * announced, because a screen reader registers the region and the text together. At the three sites whose
 * host mounts and starts its read in one step, the first read must be a CHANGE inside a region that
 * already exists: empty when the host mounts, holding the loading text after the first paint, and the
 * same element throughout.
 */
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const regions = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="status"]')];
const loading = (root: HTMLElement) => regions(root).filter((r) => r.textContent?.trim() === 'Loading…');

/** The first read, as one pin: every region that will say 'Loading…' existed, empty, before it said it. */
async function expectFirstReadIsAChange(root: HTMLElement, expected: number) {
  const before = regions(root);
  expect(loading(root), 'nothing is announced in the render that inserts the regions').toHaveLength(0);
  await firstPaint();
  const speaking = loading(root);
  expect(speaking, 'the loading text arrives after the first paint').toHaveLength(expected);
  for (const region of speaking) expect(before, 'and arrives in a region that was already there').toContain(region);
}

const node = { id: 'n1', loc: 'note', name: 'Note', content: 'original draft', revision: 7 };
const answer = {
  list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [node], total: 1, offset: 0 } },
  replacement: { state: 'ok', value: node },
  original: { state: 'ok', value: { ...node, content: 'base text' } },
};

describe('InstallCustomisation first read (#2388)', () => {
  it('list: the region is empty at mount and says Loading… after the first paint', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const m = mountComponent(InstallCustomisation as never, {
      appRef: 'app-a', agent: { id: 'ag-a', name: 'Sample Agent', urn: 'hrn:agent:acme.com:sample' }, canManage: true,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(4);
    await expectFirstReadIsAChange(m.target, 1);
  });

  it('original and replacement: on the first Open their regions are empty, then say Loading…', async () => {
    const json = () => new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async () => json()));
    const m = mountComponent(InstallCustomisation as never, {
      appRef: 'app-a', agent: { id: 'ag-a', name: 'Sample Agent', urn: 'hrn:agent:acme.com:sample' }, canManage: true,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await new Promise((r) => setTimeout(r, 0));
    await firstPaint();
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const pre = regions(m.target);
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Open')!.click();
    await tick(4);
    // The Open inserts the Original and Replacement regions, and starts their reads in the same step.
    const inserted = regions(m.target).filter((r) => !pre.includes(r));
    expect(inserted.length, 'the Open inserted the original and replacement regions').toBeGreaterThanOrEqual(2);
    expect(inserted.filter((r) => r.textContent?.trim() === 'Loading…'), 'nothing is announced in the render that inserts them').toHaveLength(0);
    await firstPaint();
    expect(inserted.filter((r) => r.textContent?.trim() === 'Loading…'), 'both say Loading… after the first paint, in the same elements').toHaveLength(2);
  });
});

describe('TaskActionBar pickers first read (#2388)', () => {
  const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
  const dara = { id: 'w1', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
  const task = {
    id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
    source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: [],
    description: null, requirements: null, createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
    startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true, result: null, sessionEndRequest: null,
  };
  it.each([
    ['reassign panel', /^Reassign/, 'reassign'],
    ['edit panel', /^Edit/, 'edit'],
  ])('%s: the region is empty when the panel mounts, then says Loading…', async (_n, label, panelId) => {
    const loadPickers = vi.fn(() => new Promise<unknown>(() => {}));
    const m = mountComponent(TaskActionBar as never, {
      task, canWrite: true, impersonating: null, loadPickers, loadMemories: async () => ({ kind: 'ok', value: [] }), openChildren: { count: 0, capped: false },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="task-actions"] button')].find((b) => label.test(b.textContent?.trim() ?? ''))!.click();
    await tick(3);
    const panel = m.target.querySelector<HTMLElement>(`#task-panel-${panelId}`)!;
    expect(loadPickers).toHaveBeenCalled();
    await expectFirstReadIsAChange(panel, 1);
  });
});

describe('LazySection first read (#2388)', () => {
  it('the unread label is empty at mount, then says Loading…', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    const m = mountComponent(LazySection as never, { appId: 'app-1', taskId: 'A', section: 'history', children: answerSnippet } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(4);
    await expectFirstReadIsAChange(m.target, 1);
  });
});
