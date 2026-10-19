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
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
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
      'Its 2 open subtasks aren’t cancelled. They stay as they are.',
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

  // Uma's P3-1 on #1135: when the reload ends the task, its actions go, and
  // the TASK_ENDED refusal must stay in view rather than vanish with them.
  it('a TASK_ENDED refusal stays in view after the reload ends the task', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      task: task(), canWrite: true, impersonating: null, candidates, openChildren: { count: 0, capped: false },
    });
    const m = mountComponent(TaskActionBar as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    button(m.target, 'Cancel…').click();
    await tick(2);
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('#task-panel-cancel')!, {
      type: 'failure', status: 409,
      data: { action: 'cancel', refusal: { kind: 'refused', code: 'TASK_ENDED', message: 'This task is cancelled; an ended task never moves again.' } },
    });
    props.task = task({ status: 'CANCELLED' });
    await tick(3);
    expect(m.target.querySelector('[data-testid="task-actions"]')).toBeNull();
    expect(m.target.textContent).toContain('This task is cancelled; an ended task never moves again.');
    expect(m.target.textContent).toContain('TASK_ENDED');
  });

  // Uma's P3-5: each panel is named by its heading.
  it('names each panel by its heading', async () => {
    const root = await mountBar();
    button(root, 'Cancel…').click();
    await tick(2);
    const panel = root.querySelector('#task-panel-cancel')!;
    const heading = root.querySelector(`#${panel.getAttribute('aria-labelledby')}`);
    expect(heading?.textContent).toContain('Cancel “Ship it”?');
  });

  // Uma's P3-4: "Task created." gets focus, like every other result line.
  it('focuses "Task created." after a create', async () => {
    const root = await mountBar({}, { created: true });
    const status = root.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe('Task created.');
    expect(document.activeElement).toBe(status);
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

  // portal#1143 — Park: state only (an unassigned PENDING task), the server answers who may.
  describe('Park', () => {
    const pending = { status: 'PENDING', assignee: null };

    it('is offered for an unassigned PENDING task, and not for an assigned one or a backlog one', async () => {
      expect(button(await mountBar(pending), 'Park…')).toBeTruthy();
      expect(button(await mountBar({ status: 'PENDING' }), 'Park…')).toBeUndefined();
      expect(button(await mountBar({ status: 'BACKLOG', assignee: null }), 'Park…')).toBeUndefined();
    });

    it('opens a confirmation focused on its safe choice; Escape closes it and returns focus to the toggle', async () => {
      const root = await mountBar(pending);
      button(root, 'Park…').click();
      await tick(2);
      const panel = root.querySelector('#task-panel-park')!;
      expect(root.querySelector(`#${panel.getAttribute('aria-labelledby')}`)?.textContent).toContain('Park “Ship it”?');
      expect(document.activeElement?.textContent?.trim()).toBe('Not yet');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await tick(2);
      expect(root.querySelector('#task-panel-park')).toBeNull();
      expect(document.activeElement).toBe(button(root, 'Park…'));
    });

    it('a refusal for someone outside the audience stays in the panel with the server’s sentence', async () => {
      const root = await mountBar(pending);
      button(root, 'Park…').click();
      await tick(2);
      const message = "Only the task's owner, a worker the owner reports to, or whoever manages the App, parks it.";
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-park')!, {
        type: 'failure', status: 403, data: { action: 'park', refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message } },
      });
      await tick(2);
      const alert = root.querySelector('#task-panel-park [role="alert"]');
      expect(alert?.textContent).toContain(`“${message}”`);
      expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    });

    it('a stale view (assigned meanwhile) reloads, closes the panel and keeps the refusal in view', async () => {
      const root = await mountBar(pending);
      button(root, 'Park…').click();
      await tick(2);
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-park')!, {
        type: 'failure', status: 409, data: { action: 'park', refusal: { kind: 'refused', code: 'TASK_INVALID_TRANSITION', message: 'Only a pending task with no assignee is parked.' } },
      });
      await tick(2);
      expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
      expect(root.querySelector('#task-panel-park')).toBeNull();
      expect(root.textContent).toContain('Only a pending task with no assignee is parked.');
    });

    it('a success reloads and says it is back in the backlog, focus on the status line', async () => {
      const root = await mountBar(pending);
      button(root, 'Park…').click();
      await tick(2);
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-park')!, {
        type: 'success', status: 200, data: { action: 'park', ok: true },
      });
      await tick(3);
      flushSync();
      expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
      const status = root.querySelector('[role="status"]');
      expect(status?.textContent?.trim()).toBe('Parked: it’s back in the backlog.');
      expect(document.activeElement).toBe(status);
    });

    it('Make ready no longer says Park is unavailable', async () => {
      const root = await mountBar({ status: 'BACKLOG', assignee: null });
      button(root, 'Make ready').click();
      await tick(2);
      expect(root.textContent).not.toContain('use the CLI or MCP for now');
      expect(root.textContent).toContain('Park');
    });
  });
});
