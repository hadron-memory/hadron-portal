/**
 * portal#1090 — the action bar, mounted (design §3, §4, §7): panels open
 * inline with focus on their safe choice, Escape returns focus to the toggle,
 * a refusal stays in the panel verbatim, a stale view reloads and closes, a
 * success reloads and says what happened. Nothing is optimistic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import TaskActionBar from './TaskActionBar.svelte';

const dara = { id: 'w1', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true, result: null, sessionEndRequest: null,
  ...over,
});
const candidates = {
  workers: [dara, { id: 'w2', kind: 'WORKER' as const, name: 'Kai', urn: 'hrn:worker:acme.com:team:kai' }].map((w) => ({ id: w.id, name: w.name ?? '', role: 'eng', urn: w.urn })),
  people: [{ id: 'u2', handle: 'rae', name: 'Rae' }],
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  vi.restoreAllMocks();
});

async function mountBar(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const m = mountComponent(TaskActionBar as never, {
    task: task(over), canWrite: true, impersonating: null, candidates, openChildren: { count: 2, capped: false }, ...props,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

describe('TaskActionBar', () => {
  it('Cancel… opens a confirmation focused on Keep task, listing only what is true; Escape closes it and returns focus', async () => {
    const root = await mountBar();
    button(root, 'Cancel…').click();
    await tick(2);
    expect(document.activeElement?.textContent?.trim()).toBe('Keep task');
    const lines = [...root.querySelectorAll('[data-testid="cancel-consequences"] li')].map((li) => li.textContent?.trim());
    expect(lines).toEqual([
      'A cancelled task can’t be reopened.',
      'Dara can no longer work on it.',
      'Dara will be asked to end its session, if it has one open.',
      'Its 2 open subtask(s) aren’t cancelled. They stay as they are.',
    ]);
    expect(button(root, 'Cancel…').getAttribute('aria-expanded')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick(2);
    expect(root.querySelector('#task-panel-cancel')).toBeNull();
    expect(document.activeElement).toBe(button(root, 'Cancel…'));
  });

  it('Reassign… leaves the current assignee out of the picker', async () => {
    const root = await mountBar();
    button(root, 'Reassign…').click();
    await tick(2);
    const values = [...root.querySelectorAll<HTMLOptionElement>('#task-assignee option')].map((o) => o.value);
    expect(values).toContain('worker:w2');
    expect(values).not.toContain('worker:w1');
  });

  it('a refusal stays in the panel, verbatim with its code, and nothing reloads', async () => {
    const root = await mountBar();
    button(root, 'Cancel…').click();
    await tick(2);
    const form = root.querySelector<HTMLFormElement>('#task-panel-cancel')!;
    const message = "Only the task's owner, a worker the owner reports to, or whoever manages the App, cancels it.";
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { action: 'cancel', refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message } } });
    await tick(2);
    const alert = root.querySelector('#task-panel-cancel [role="alert"]');
    expect(alert?.textContent).toContain('Not changed');
    expect(alert?.textContent).toContain(`“${message}”`);
    expect(alert?.textContent).toContain('TASK_NOT_OWNER');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('a stale view (TASK_INVALID_TRANSITION) reloads, closes the panel and keeps the refusal in view', async () => {
    const root = await mountBar({ status: 'BACKLOG', assignee: null });
    button(root, 'Make ready').click();
    await tick(2);
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-ready')!, {
      type: 'failure', status: 409,
      data: { action: 'ready', refusal: { kind: 'refused', code: 'TASK_INVALID_TRANSITION', message: 'Only a backlog task is made ready to be worked.' } },
    });
    await tick(2);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(root.querySelector('#task-panel-ready')).toBeNull();
    expect(root.textContent).toContain('Only a backlog task is made ready to be worked.');
  });

  it('an unknown failure shows the fixed uncertainty line', async () => {
    const root = await mountBar();
    button(root, 'Cancel…').click();
    await tick(2);
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-cancel')!, {
      type: 'failure', status: 502, data: { action: 'cancel', refusal: { kind: 'uncertain' } },
    });
    await tick(2);
    expect(root.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(root.textContent).not.toContain('Not changed');
  });

  it('a success reloads, closes the panel and says what happened, with focus on the status line', async () => {
    const root = await mountBar();
    button(root, 'Cancel…').click();
    await tick(2);
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-cancel')!, {
      type: 'success', status: 200, data: { action: 'cancel', ok: true },
    });
    await tick(3);
    flushSync();
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(root.querySelector('#task-panel-cancel')).toBeNull();
    const status = root.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe('Cancelled.');
    expect(document.activeElement).toBe(status);
  });
});
