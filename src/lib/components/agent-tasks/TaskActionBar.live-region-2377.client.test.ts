import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import TaskActionBar from './TaskActionBar.svelte';

/**
 * portal#2344 / #2377 slice 4: the pickers' 'Loading…' line (assign/reassign panel and edit panel) is a
 * persistent LiveRegion. The panel itself mounts when it is opened, and the read starts on that open, so the
 * region is populated from its first render: the pin is its identity across loading -> loaded, plus a retry
 * round (failed -> loading again) where it demonstrably exists, empty, before the second read.
 */
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const dara = { id: 'w1', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const task = {
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true, result: null, sessionEndRequest: null,
};
const ok = { kind: 'ok' as const, value: {
  workers: [{ id: 'w2', name: 'Kai', role: 'eng', urn: 'hrn:worker:acme.com:team:kai' }],
  people: [{ id: 'u2', handle: 'rae', name: 'Rae' }], roles: [], families: [],
} };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.restoreAllMocks(); });

const loadingRegions = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => r.textContent?.trim() === 'Loading…');
const toggle = (root: HTMLElement, label: RegExp) =>
  [...root.querySelectorAll<HTMLButtonElement>('[data-testid="task-actions"] button')].find((b) => label.test(b.textContent?.trim() ?? ''))!;

describe.each([
  ['assign/reassign panel', /^Reassign/, 'reassign'],
  ['edit panel', /^Edit/, 'edit'],
])('%s pickers loading line', (_name, label, panelId) => {
  it('is one region across loading -> loaded, and across a failed read retried', async () => {
    const answers: Array<(r: unknown) => void> = [];
    const loadPickers = vi.fn(() => new Promise<unknown>((r) => { answers.push(r); }));
    const m = mountComponent(TaskActionBar as never, {
      task, canWrite: true, impersonating: null, loadPickers, loadMemories: async () => ({ kind: 'ok', value: [] }), openChildren: { count: 0, capped: false },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const root = m.target;

    toggle(root, label).click();
    await tick(3);
    const panel = root.querySelector<HTMLElement>(`#task-panel-${panelId}`)!;
    const during = loadingRegions(panel);
    expect(during, 'one loading region in the open panel').toHaveLength(1);
    const region = during[0];

    // The first read fails: the region empties, the alert says so, and the SAME region is still there.
    answers.shift()!({ kind: 'failed' });
    await tick(4);
    expect(region.isConnected).toBe(true);
    expect(region.textContent?.trim()).toBe('');
    expect(panel.querySelector('[role="alert"]')).not.toBeNull();

    // Retry: the region existed, empty, before this second read; it speaks and is still the same element.
    [...panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
    await tick(3);
    expect(loadingRegions(panel)).toEqual([region]);

    answers.shift()!(ok);
    await tick(4);
    expect(region.isConnected).toBe(true);
    expect(region.textContent?.trim()).toBe('');
    expect(loadingRegions(panel)).toHaveLength(0);
  });
});
