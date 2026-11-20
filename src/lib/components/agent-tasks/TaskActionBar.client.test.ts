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
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { HAND_BACK_TEXT_MAX, parseHandBack } from '$lib/agent-tasks/hand-back';
import TaskActionBar from './TaskActionBar.svelte';
import { firstPopulatedStatusText, announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';

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

/** The status regions that existed, empty, right after mount: a result must be spoken by one of these. */
let idleAtMount: HTMLElement[] = [];
async function mountBar(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const m = mountComponent(TaskActionBar as never, {
    task: task(over), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } }), loadMemories: async () => ({ kind: 'ok' as const, value: [] }), openChildren: { count: 2, capped: false }, ...props,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  idleAtMount = idleStatusRegions(m.target);
  return m.target;
}
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
/** Presence by label, for absence checks that must not lean on `button`'s undefined-on-miss (Gaia's P3 on #1839). */
const hasButton = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].some((b) => b.textContent?.trim() === text);

/** The parser's own invalid refusal for a (code, text) pair — fixtures derive, never hand-copy (Gaia's P3 on #1839). */
function deriveInvalid(code: string, text: string) {
  const parsed = parseHandBack(code, text);
  if (!('invalid' in parsed)) throw new Error(`fixture: expected an invalid refusal for ${JSON.stringify({ code, text: text.slice(0, 30) })}`);
  return parsed.invalid;
}

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
      task: task(), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } }), loadMemories: async () => ({ kind: 'ok' as const, value: [] }), openChildren: { count: 0, capped: false },
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

  // portal#1583 item 4 (Gloria's BLIND P3 on #1577): the hand-back heading's {title}
  // interpolation, in its own test (Gaia's P3 on #1839: one panel per test, like the
  // heading convention above). Mutant: drop the { title: task.title } argument in the
  // component → renders “Hand back “”?” → red.
  it('names the hand-back panel by its heading, with the task title interpolated', async () => {
    const hb = await mountBar({ assignee: holger, status: 'STARTED' }, { viewerId: 'u1' });
    button(hb, 'Hand back…').click();
    await tick(2);
    const hbPanel = hb.querySelector('#task-panel-handBack')!;
    expect(hb.querySelector(`#${hbPanel.getAttribute('aria-labelledby')}`)?.textContent).toContain('Hand back “Ship it”?');
  });

  // Uma's P3-4: "Task created." gets focus, like every other result line.
  it('focuses "Task created." after a create', async () => {
    const root = await mountBar({}, { created: true });
    const status = announcedStatusRegion(root)?.firstElementChild ?? null;
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
    const status = announcedStatusRegion(root)?.firstElementChild ?? null;
    expect(idleAtMount, 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
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
      const status = announcedStatusRegion(root)?.firstElementChild ?? null;
      expect(idleAtMount, 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
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

  // portal#1214 — the warnings a reassign's response carried.
  describe('warnings', () => {
    const URN = 'hrn:node:hadronmemory.com:hadron-dev-team-roles:tasks:find-a-source';
    async function reassign(data: Record<string, unknown>) {
      const root = await mountBar();
      button(root, 'Reassign…').click();
      await tick(2);
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-reassign')!, { type: 'success', status: 200, data });
      await tick(3);
      flushSync();
      return root;
    }

    it('shows them under the status line after the reload, verbatim with their code', async () => {
      const root = await reassign({
        action: 'reassign', ok: true, committedWithError: false, more: 0,
        warnings: [{ code: 'task.assign.assignee-busy', text: 'The assignee already has a task started.', register: { state: 'mapped', taskLoc: 'tasks:x', taskUrn: URN } }],
      });
      expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
      const list = root.querySelector('[data-testid="task-warnings"]');
      expect(list?.textContent).toContain('The assignee already has a task started.');
      expect(list?.textContent).toContain('task.assign.assignee-busy');
      expect(list?.querySelector(`code [title="${URN}"]`)).not.toBeNull();
      expect(list?.querySelector('a')).toBeNull();
      // Uma's P2 on #1216: the focused line says the warnings follow.
      const status = announcedStatusRegion(root)?.firstElementChild ?? null;
      expect(idleAtMount, 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
      expect(status?.textContent?.trim()).toBe('Assigned. 1 warning below.');
      expect(document.activeElement).toBe(status);
    });

    it('counts what the cap left out in the focused line', async () => {
      const root = await reassign({ action: 'reassign', ok: true, committedWithError: false, more: 2, warnings: [{ code: 'c', text: 't' }] });
      expect(firstPopulatedStatusText(root)).toBe('Assigned. 3 warnings below.');
    });

    // Gene's P2 on #1216: the page reuses this bar across tasks. A result is
    // about the task it was written to: it survives that task's own reload and
    // never shows on another.
    async function mountReactive() {
      const props = reactiveProps<Record<string, unknown>>({
        task: task(), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } }), loadMemories: async () => ({ kind: 'ok' as const, value: [] }), openChildren: { count: 0, capped: false },
      });
      const m = mountComponent(TaskActionBar as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      button(m.target, 'Reassign…').click();
      await tick(2);
      return { props, root: m.target };
    }
    const busy = { action: 'reassign', ok: true, committedWithError: false, more: 0, warnings: [{ code: 'task.assign.assignee-busy', text: 'Busy.' }] };

    it('keeps task A’s warnings through A’s reload, and drops them when the bar shows task B', async () => {
      const { props, root } = await mountReactive();
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-reassign')!, { type: 'success', status: 200, data: busy });
      await tick(3);
      flushSync();
      expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();

      props.task = task({ updatedAt: '2026-10-21T10:00:00Z' });
      await tick(2);
      flushSync();
      expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();

      props.task = task({ id: 't2', title: 'Another task' });
      await tick(2);
      flushSync();
      expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
      expect(root.textContent).not.toContain('Busy.');
      expect(root.textContent).not.toContain('Assigned.');
    });

    it('a result that lands after the reader moved to another task is dropped', async () => {
      const { props, root } = await mountReactive();
      // The navigation happens during the reload the success awaits.
      navigationHooks.onInvalidateAll = () => {
        props.task = task({ id: 't2', title: 'Another task' });
      };
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-reassign')!, { type: 'success', status: 200, data: busy });
      await tick(3);
      flushSync();
      expect(root.textContent).not.toContain('Busy.');
      expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
    });

    it('a committed write whose response errored says saved, with the fixed line, never “not changed”', async () => {
      const root = await reassign({ action: 'reassign', ok: true, committedWithError: true, more: 0, warnings: [{ code: 'c', text: 't' }] });
      const status = announcedStatusRegion(root)?.firstElementChild ?? null;
      expect(idleAtMount, 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
      expect(status?.textContent?.trim()).toBe('Saved, but the server’s response also reported an error. Reload to check the task. 1 warning below.');
      expect(status?.className).toContain('text-amber-800');
      expect(root.textContent).not.toContain('Not changed');
      expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();
    });

    it('opening another panel clears them', async () => {
      const root = await reassign({ action: 'reassign', ok: true, committedWithError: false, more: 0, warnings: [{ code: 'c', text: 't' }] });
      expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();
      button(root, 'Cancel…').click();
      await tick(2);
      expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
    });

    it('a success with no warnings shows none', async () => {
      const root = await reassign({ action: 'reassign', ok: true, committedWithError: false, warnings: [], more: 0 });
      expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
    });
  });

  // portal#1571 (hrn:node:hadronmemory.com:specs:cor:agt:050:29): the assignee hands a started task back.
  describe('Hand back…', () => {
    const mine = { assignee: holger, status: 'STARTED' };

    it('is offered to the started task’s assignee who is the viewer, and to nobody else', async () => {
      expect(button(await mountBar(mine, { viewerId: 'u1' }), 'Hand back…')).toBeTruthy();
      expect(button(await mountBar(mine, { viewerId: 'u2' }), 'Hand back…')).toBeUndefined();
      expect(button(await mountBar(mine), 'Hand back…')).toBeUndefined();
      expect(button(await mountBar({ status: 'STARTED' }, { viewerId: 'w1' }), 'Hand back…')).toBeUndefined();
      expect(button(await mountBar({ ...mine, status: 'PENDING' }, { viewerId: 'u1' }), 'Hand back…')).toBeUndefined();
    });

    it('opens a dialog that says what happens, with the five reasons, none chosen, and a “Hand back” button', async () => {
      const root = await mountBar(mine, { viewerId: 'u1' });
      button(root, 'Hand back…').click();
      await tick(2);
      const panel = root.querySelector('#task-panel-handBack')!;
      expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
      expect(panel.textContent).toContain('The task goes back to the queue with no assignee, and your reason is shown on it.');
      expect(panel.textContent).not.toMatch(/won.t be given it again|excluded/i);
      const select = panel.querySelector<HTMLSelectElement>('select[name="code"]')!;
      expect(select.required).toBe(true);
      expect(select.value).toBe('');
      expect([...select.options].filter((o) => o.value).map((o) => [o.value, o.textContent?.trim()])).toEqual([
        ['MISSING_INPUT', 'Missing input'], ['CANNOT_DO', 'Can’t do it'], ['REFUSED', 'Refused'], ['OUT_OF_SCOPE', 'Out of scope'], ['DUPLICATE', 'Duplicate'],
      ]);
      const text = panel.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!;
      expect(text.hasAttribute('maxlength')).toBe(false);
      expect(panel.querySelector('form')?.getAttribute('action') ?? panel.getAttribute('action')).toBe('?/handBack');
      expect([...panel.querySelectorAll('button[type="submit"]')].map((b) => b.textContent?.trim())).toEqual(['Hand back']);
    });

    it('a refusal stays in the panel verbatim, with its code, and nothing reloads', async () => {
      const root = await mountBar(mine, { viewerId: 'u1' });
      button(root, 'Hand back…').click();
      await tick(2);
      const message = 'Only the task’s assignee hands it back.';
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-handBack')!, {
        type: 'failure', status: 403, data: { action: 'handBack', refusal: { kind: 'refused', code: 'TASK_NOT_ASSIGNEE', message } },
      });
      await tick(2);
      const alert = root.querySelector('#task-panel-handBack [role="alert"]');
      expect(alert?.textContent).toContain('Not changed');
      expect(alert?.textContent).toContain(`“${message}”`);
      expect(alert?.textContent).toContain('TASK_NOT_ASSIGNEE');
      expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    });

    it('a success reloads, closes the panel and says the task is back in the queue', async () => {
      const root = await mountBar(mine, { viewerId: 'u1' });
      button(root, 'Hand back…').click();
      await tick(2);
      await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#task-panel-handBack')!, {
        type: 'success', status: 200, data: { action: 'handBack', ok: true },
      });
      await tick(3);
      expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
      expect(root.querySelector('#task-panel-handBack')).toBeNull();
      expect(firstPopulatedStatusText(root)).toContain('Handed back: it’s back in the queue.');
    });

    it('after the reload (PENDING, no assignee) the bar no longer offers hand-back', async () => {
      const props = reactiveProps<Record<string, unknown>>({
        task: task(mine), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } }), loadMemories: async () => ({ kind: 'ok' as const, value: [] }), openChildren: { count: 0, capped: false }, viewerId: 'u1',
      });
      const m = mountComponent(TaskActionBar as never, props as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      expect(button(m.target, 'Hand back…')).toBeTruthy();
      props.task = task({ status: 'PENDING', assignee: null, queued: true });
      await tick(3);
      expect(button(m.target, 'Hand back…')).toBeUndefined();
    });

    // Gizelle's P3 / Charles's P3 on #1577: a native maxlength counts raw text and makes the server's
    // trimmed-length message unreachable, so the textarea carries none; parseHandBack owns the cap.
    it('leaves the length cap to the parser: the textarea has no native maxlength', async () => {
      const root = await mountBar(mine, { viewerId: 'u1' });
      button(root, 'Hand back…').click();
      await tick(2);
      expect(root.querySelector('#hand-back-text')?.hasAttribute('maxlength')).toBe(false);
    });

    // Gizelle's P2 on #1577: an open hand-back draft belongs to the task and eligibility it was opened under.
    describe('an open draft', () => {
      async function openDraft() {
        const props = reactiveProps<Record<string, unknown>>({
          task: task(mine), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } }), loadMemories: async () => ({ kind: 'ok' as const, value: [] }), openChildren: { count: 0, capped: false }, viewerId: 'u1',
        });
        const m = mountComponent(TaskActionBar as never, props as never) as Mounted<Record<string, unknown>>;
        mounted.push(m);
        await tick(2);
        button(m.target, 'Hand back…').click();
        await tick(2);
        const text = m.target.querySelector<HTMLTextAreaElement>('#hand-back-text')!;
        text.value = 'reason for A';
        text.dispatchEvent(new Event('input', { bubbles: true }));
        return { props, root: m.target };
      }

      it('closes when the bar moves to another started task of the same assignee', async () => {
        const { props, root } = await openDraft();
        // Gaia's P2-1 on #1839: the removed textContent check ('not toContain reason for A')
        // was vacuous — a one-way-bound textarea's value never reaches textContent — and a raw
        // DOM draft never enters `values` either. The one state that COULD pre-fill task B's
        // panel is `values` populated by a submit, so post task A's draft first: a refused
        // submit leaves the panel open with values = { code, text } from the FormData.
        const form = root.querySelector<HTMLFormElement>('#task-panel-handBack')!;
        form.querySelector<HTMLSelectElement>('select[name="code"]')!.value = 'MISSING_INPUT';
        await submitEnhancedWithResult(form, {
          type: 'failure', status: 500, data: { action: 'handBack' },
        });
        await tick(2);
        expect(root.querySelector('#task-panel-handBack')).not.toBeNull();
        props.task = task({ ...mine, id: 't2', title: 'Task B' });
        await tick(3);
        flushSync();
        expect(root.querySelector('#task-panel-handBack')).toBeNull();
        // Re-open Hand back on task B: the draft starts empty (openPanel resets values),
        // never task A's text or reason. Mutant: openPanel skips the values reset → red.
        button(root, 'Hand back…').click();
        await tick(2);
        expect(root.querySelector<HTMLTextAreaElement>('#hand-back-text')?.value).toBe('');
        expect(root.querySelector<HTMLSelectElement>('select[name="code"]')?.value).toBe('');
      });

      // portal#1583 item 2 (Gloria's BLIND delta on #1577): each closure must be pinned to the
      // ELIGIBILITY effect, not to the section unmounting or a task-id change. The task keeps its
      // id (so the task-id branch cannot fire) and the actions strip still renders its other
      // buttons, so only the eligibility effect can have closed the panel.
      it('closes when the same task becomes PENDING', async () => {
        const { props, root } = await openDraft();
        props.task = task({ status: 'PENDING', assignee: null, queued: true });
        await tick(3);
        flushSync();
        expect(root.querySelector('[data-testid="task-actions"]')).not.toBeNull();
        expect(hasButton(root, 'Hand back…')).toBe(false);
        expect(root.querySelector('#task-panel-handBack')).toBeNull();
        // Gaia's P2-2 on #1839: re-eligible with the SAME id, then still closed — a
        // markup-independent mutant kill. If the eligibility effect were removed, the panel
        // never closed and is open again here (the button's return proves the strip is live);
        // only the effect, which closes and never reopens, passes both halves.
        props.task = task(mine);
        await tick(3);
        flushSync();
        expect(button(root, 'Hand back…')).toBeTruthy();
        expect(root.querySelector('#task-panel-handBack')).toBeNull();
      });

      it('closes when the same task is reassigned away from the viewer', async () => {
        const { props, root } = await openDraft();
        props.task = task({ status: 'STARTED', assignee: { ...holger, id: 'u2' } });
        await tick(3);
        flushSync();
        expect(root.querySelector('[data-testid="task-actions"]')).not.toBeNull();
        expect(hasButton(root, 'Hand back…')).toBe(false);
        expect(root.querySelector('#task-panel-handBack')).toBeNull();
        // Gaia's P2-2 on #1839, same shape as the PENDING test above.
        props.task = task(mine);
        await tick(3);
        flushSync();
        expect(button(root, 'Hand back…')).toBeTruthy();
        expect(root.querySelector('#task-panel-handBack')).toBeNull();
      });

      // portal#1583 item 1 (Gloria's BLIND delta on #1577): “draft intact” is the textarea's
      // VALUE, not just the panel's existence. Mutant: clear the draft on a re-render → red.
      it('stays open, draft intact, when the same eligible task re-renders', async () => {
        const { props, root } = await openDraft();
        props.task = task({ ...mine, updatedAt: '2026-10-21T10:00:00Z' });
        await tick(3);
        flushSync();
        expect(root.querySelector('#task-panel-handBack')).not.toBeNull();
        expect(root.querySelector<HTMLTextAreaElement>('#hand-back-text')?.value).toBe('reason for A');
      });

      // portal#1583 item 3 (Gloria's BLIND P3 on #1577): the invalid-refusal branch — the panel
      // stays open, the sentence shows inline (never the “Not changed” refusal alert), focus
      // moves to the field the branch names, and the draft survives the refusal (item 1's
      // mutant: clear the draft on refusal → the value assertion goes red). The fixture is the
      // one invalid field:'text' the contract can produce — parseHandBack's too-long refusal
      // (text is optional, so there is no minimum) — derived from the parser itself (Gaia's P3
      // on #1839: no hand-copied message to drift), in the exact shape writeFailure sends
      // ({ action, refusal, values }, status 400). The controls are one-way bound; the raw
      // .value assignments are what the submit's FormData reads.
      // Mutant: remove the branch's guard → focus never reaches hand-back-text → red.
      it('an invalid refusal (text over the cap) keeps the panel and draft, shows the sentence inline, and focuses the field it names', async () => {
        const { root } = await openDraft();
        const form = root.querySelector<HTMLFormElement>('#task-panel-handBack')!;
        const select = form.querySelector<HTMLSelectElement>('select[name="code"]')!;
        select.value = 'MISSING_INPUT';
        const tooLong = 'a'.repeat(HAND_BACK_TEXT_MAX + 1);
        const textEl = form.querySelector<HTMLTextAreaElement>('#hand-back-text')!;
        textEl.value = tooLong;
        const invalid = deriveInvalid('MISSING_INPUT', tooLong);
        expect(invalid.field).toBe('text');
        await submitEnhancedWithResult(form, {
          type: 'failure', status: 400,
          data: { action: 'handBack', refusal: { kind: 'invalid', ...invalid }, values: { code: 'MISSING_INPUT', text: tooLong } },
        });
        await tick(2);
        // Gaia's P3 on #1839: re-query after the submit; the pre-submit references are for
        // setting up the FormData, not for reading the re-rendered panel.
        const panel = root.querySelector<HTMLFormElement>('#task-panel-handBack')!;
        const alert = panel.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain(invalid.message);
        expect(alert?.textContent).not.toContain('Not changed');
        expect(panel.querySelector<HTMLTextAreaElement>('#hand-back-text')!.getAttribute('aria-invalid')).toBe('true');
        expect(panel.querySelector<HTMLSelectElement>('select[name="code"]')!.getAttribute('aria-invalid')).toBeNull();
        expect(document.activeElement?.id).toBe('hand-back-text');
        expect(panel.querySelector<HTMLTextAreaElement>('#hand-back-text')!.value).toBe(tooLong);
        expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
      });

      // portal#1583 item 3, the branch's other arm: parseHandBack refuses field:'code' (“Choose a
      // reason.”) when the posted code is unknown — exactly this form's state, the select left on
      // its disabled placeholder. The refusal is derived from the parser, and the checks mirror
      // the text-cap test above (Gaia's P3 on #1839: same assertions both arms).
      // Mutant: drop the `: 'hand-back-code'` focus arm → red.
      it('an invalid refusal (no reason chosen) focuses the select and marks it, not the text', async () => {
        const { root } = await openDraft();
        const form = root.querySelector<HTMLFormElement>('#task-panel-handBack')!;
        const invalid = deriveInvalid('', 'reason for A');
        expect(invalid.field).toBe('code');
        await submitEnhancedWithResult(form, {
          type: 'failure', status: 400,
          data: {
            action: 'handBack',
            refusal: { kind: 'invalid', ...invalid },
            values: { code: '', text: 'reason for A' },
          },
        });
        await tick(2);
        const panel = root.querySelector<HTMLFormElement>('#task-panel-handBack')!;
        const alert = panel.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain(invalid.message);
        expect(alert?.textContent).not.toContain('Not changed');
        expect(panel.querySelector<HTMLSelectElement>('select[name="code"]')!.getAttribute('aria-invalid')).toBe('true');
        expect(panel.querySelector<HTMLTextAreaElement>('#hand-back-text')!.getAttribute('aria-invalid')).toBeNull();
        expect(document.activeElement?.id).toBe('hand-back-code');
        expect(panel.querySelector<HTMLTextAreaElement>('#hand-back-text')!.value).toBe('reason for A');
        expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
      });
    });
  });
});

// portal#2161 — the Clone link: a create offered beside the state's actions on every status
// (replacing an ended task is what the action is for), never one of them and never a panel.
// The page withholds it from AT0 (no bar at all) and from a support session; those gates are
// pinned here at the bar's own contract: no href, no link.
describe('TaskActionBar: Clone (portal#2161)', () => {
  const href = '/app/apps/app-1/tasks/new?from=t1';
  const cloneLink = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('a[data-testid="task-clone"]');

  it('a finished task with no state actions offers Clone beside the ended note', async () => {
    const root = await mountBar({ status: 'FINISHED', finishedAt: '2026-11-01T00:00:00Z' }, { cloneHref: href });
    expect(cloneLink(root)?.getAttribute('href')).toBe(href);
    expect(cloneLink(root)?.textContent?.trim()).toBe('Clone');
    expect(root.textContent).toContain('An ended task can’t be changed.');
  });

  it('a cancelled task offers Clone the same way', async () => {
    const root = await mountBar({ status: 'CANCELLED', cancelledAt: '2026-11-01T00:00:00Z' }, { cloneHref: href });
    expect(cloneLink(root)?.getAttribute('href')).toBe(href);
    expect(root.textContent).toContain('An ended task can’t be changed.');
  });

  it('a live task offers Clone in the actions row, beside them rather than among them', async () => {
    const root = await mountBar({}, { cloneHref: href });
    const row = root.querySelector('[data-testid="task-actions"]');
    expect(row).not.toBeNull();
    expect(row!.contains(cloneLink(root))).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('[data-testid="task-actions"] button')].some((b) => b.textContent?.trim() === 'Clone')).toBe(false);
  });

  it('no cloneHref, no link', async () => {
    const root = await mountBar({ status: 'FINISHED', finishedAt: '2026-11-01T00:00:00Z' });
    expect(cloneLink(root)).toBeNull();
  });

  it('an impersonation session sees no Clone link', async () => {
    const root = await mountBar({}, { cloneHref: href, canWrite: false, impersonating: 'Mike' });
    expect(cloneLink(root)).toBeNull();
    expect(root.textContent).toContain('Viewing as Mike');
  });
});

describe('TaskActionBar pickers across Apps (Gil P3 on #2263)', () => {
  it('another App\'s options are read again, never carried over from the first App', async () => {
    const reads: string[] = [];
    const props = reactiveProps({
      task: task(), canWrite: true, impersonating: null, openChildren: { count: 0, capped: false },
      loadPickers: async () => {
        reads.push('read');
        return { kind: 'ok' as const, value: { ...candidates, roles: [], families: [] } };
      },
      loadMemories: async () => ({ kind: 'ok' as const, value: [] }),
    } as Record<string, unknown>);
    const m = mountComponent(TaskActionBar as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(4);
    button(m.target, 'Reassign…').click();
    await tick(6);
    expect(reads).toHaveLength(1);

    props.task = task({ id: 't2', appId: 'app-2' }); // a cross-App parent or blocker link
    await tick(6);
    expect(reads).toHaveLength(2); // the open panel reads the new App's options at once
  });
});
