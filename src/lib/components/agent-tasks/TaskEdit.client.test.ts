/**
 * portal#1357 — the Edit details panel, mounted (hadron-server#2645). It opens
 * on any non-ended task with the create form's fields pre-filled and each
 * field's base posted beside it; it carries no source, owner, assignee, status
 * or parent control; a refusal keeps the draft; a late data refresh or another
 * task never reseeds or inherits an open draft; the success, unchanged and
 * stale-view lines are said in words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult, beginEnhanced } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskActionBar from './TaskActionBar.svelte';

const dara = { id: 'w1', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: 'https://example.com/x', owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: ['a', 'b'],
  description: 'Do the thing', requirements: null, createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true, result: null, sessionEndRequest: null,
  ...over,
});
const candidates = {
  workers: [{ id: 'w1', name: 'Dara', role: 'eng', urn: dara.urn }, { id: 'w2', name: 'Kai', role: 'eng', urn: 'hrn:worker:acme.com:team:kai' }],
  people: [{ id: 'u2', handle: 'rae', name: 'Rae' }],
};
const roles = ['portal-engineer', 'qa-engineer'];
const families = ['claude', 'codex'];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  vi.restoreAllMocks();
});
async function mountBar(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const p = reactiveProps<Record<string, unknown>>({
    task: task(over), canWrite: true, impersonating: null, candidates, roles, families, openChildren: { count: 0, capped: false }, ...props,
  });
  const m = mountComponent(TaskActionBar as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
async function openEdit(root: HTMLElement) {
  button(root, 'Edit details')!.click();
  await tick(2);
  return root.querySelector<HTMLFormElement>('#task-panel-edit')!;
}
const field = (form: HTMLFormElement, name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;

describe('Edit details: who is offered it', () => {
  it.each(['BACKLOG', 'PENDING', 'STARTED'])('is offered on a %s task', async (status) => {
    const { root } = await mountBar({ status, assignee: status === 'STARTED' ? dara : null });
    expect(button(root, 'Edit details')).toBeTruthy();
  });
  it.each(['FINISHED', 'CANCELLED'])('is offered on no %s task', async (status) => {
    const { root } = await mountBar({ status });
    expect(button(root, 'Edit details')).toBeUndefined();
  });
  it('is not offered in a support (impersonation) session', async () => {
    const { root } = await mountBar({}, { canWrite: false, impersonating: 'Someone' });
    expect(button(root, 'Edit details')).toBeUndefined();
  });
});

describe('Edit details: the panel', () => {
  it('opens pre-filled with the current values and each field’s base', async () => {
    const { root } = await mountBar({ startBy: '2026-11-02T15:30:00.000Z', closeSessionWhenDone: false, requirements: { role: 'qa-engineer', familyIn: null, familyNotIn: ['glm'], excludeWorkerIds: ['w2'] } });
    const form = await openEdit(root);
    expect(field(form, 'title').value).toBe('Ship it');
    expect(form.querySelector<HTMLTextAreaElement>('[name="description"]')!.value).toBe('Do the thing');
    expect(field(form, 'tags').value).toBe('a, b');
    expect(field(form, 'closeSessionWhenDone').checked).toBe(false);
    expect(form.querySelector<HTMLSelectElement>('[name="role"]')!.value).toBe('qa-engineer');
    expect([...form.querySelectorAll<HTMLOptionElement>('[name="excludeWorkers"] option')].filter((o) => o.selected).map((o) => o.value)).toEqual(['w2']);
    expect(field(form, 'titleBase').value).toBe('Ship it');
    expect(field(form, 'descriptionBase').value).toBe('Do the thing');
    expect(field(form, 'tagsBase').value).toBe('a, b');
    expect(field(form, 'startByBase').value).toBe('2026-11-02T15:30:00.000Z');
    expect(field(form, 'closeSessionWhenDoneBase').value).toBe('false');
    expect(JSON.parse(field(form, 'requirementsBase').value)).toEqual({ role: 'qa-engineer', familyIn: [], familyNotIn: ['glm'], excludeWorkers: ['w2'], minTier: null });
  });

  it('opening and saving untouched changes nothing: every posted field equals its base', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    const fd = new FormData(form);
    expect(fd.get('title')).toBe(fd.get('titleBase'));
    expect(fd.get('description')).toBe(fd.get('descriptionBase'));
    expect(fd.get('tags')).toBe(fd.get('tagsBase'));
  });

  it('has no source, owner, assignee, status, parent, priority or blocker control', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    const names = new Set([...form.querySelectorAll('[name]')].map((e) => e.getAttribute('name')));
    for (const n of ['source', 'owner', 'ownerOther', 'assignee', 'assigneeOther', 'status', 'parentTaskId', 'priority', 'blockedBy']) expect(names.has(n)).toBe(false);
  });

  it('keeps a requirement value the pickers do not list, rather than dropping it on save', async () => {
    const { root } = await mountBar({ requirements: { role: 'retired-role', familyIn: ['gemini'], familyNotIn: null, excludeWorkerIds: ['w-gone'] } });
    const form = await openEdit(root);
    expect(form.querySelector<HTMLSelectElement>('[name="role"]')!.value).toBe('retired-role');
    expect([...form.querySelectorAll<HTMLOptionElement>('[name="familyIn"] option')].filter((o) => o.selected).map((o) => o.value)).toEqual(['gemini']);
    expect([...form.querySelectorAll<HTMLOptionElement>('[name="excludeWorkers"] option')].filter((o) => o.selected).map((o) => o.value)).toEqual(['w-gone']);
  });

  it('seeds the stored minimum tier, posts it in the base, and shows a tier the picker does not list as it is (portal#1523)', async () => {
    const { root } = await mountBar({ requirements: { role: null, familyIn: null, familyNotIn: null, excludeWorkerIds: null, minTier: 'mid' } });
    const form = await openEdit(root);
    expect(form.querySelector<HTMLSelectElement>('[name="minTier"]')!.value).toBe('mid');
    expect(JSON.parse((form.querySelector('[name="requirementsBase"]') as HTMLInputElement).value).minTier).toBe('mid');
    root.remove();
    const odd = await mountBar({ requirements: { role: null, familyIn: null, familyNotIn: null, excludeWorkerIds: null, minTier: 'ultra' } });
    const f2 = await openEdit(odd.root);
    expect(f2.querySelector<HTMLSelectElement>('[name="minTier"]')!.value).toBe('ultra');
  });

  // portal#1530: with no minimum the server still matches unknown-tier workers (they sort last),
  // so the help must qualify the exclusion to a selected minimum — in both the Any and the
  // seeded-minimum render, with the form still serializing exactly what it did.
  it('the min-tier help qualifies the unknown-tier exclusion to a selected minimum, for Any and for a seeded tier (portal#1530)', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    expect(form.querySelector('#edit-min-tier-help')!.textContent).toContain('When a minimum is selected, a worker whose tier is unknown won’t be picked.');
    expect(new FormData(form).get('minTier')).toBe('');
    expect(JSON.parse(field(form, 'requirementsBase').value).minTier).toBeNull();
    root.remove();
    const tiered = await mountBar({ requirements: { role: null, familyIn: null, familyNotIn: null, excludeWorkerIds: null, minTier: 'mid' } });
    const f2 = await openEdit(tiered.root);
    expect(f2.querySelector('#edit-min-tier-help')!.textContent).toContain('When a minimum is selected, a worker whose tier is unknown won’t be picked.');
    expect(new FormData(f2).get('minTier')).toBe('mid');
    expect(JSON.parse(field(f2, 'requirementsBase').value).minTier).toBe('mid');
  });

  it('says tags and requirements are replaced as shown, and that a started or assigned task keeps its worker', async () => {
    const { root } = await mountBar({ status: 'STARTED' });
    const form = await openEdit(root);
    expect(form.textContent).toMatch(/replaced as shown/i);
    expect(form.textContent).toMatch(/doesn.t move the task|does not move the task/i);
    expect(form.textContent).toMatch(/next assignment/i);
  });

  it('says nothing about "next assignment" for an unassigned backlog task', async () => {
    const { root } = await mountBar({ status: 'BACKLOG', assignee: null });
    const form = await openEdit(root);
    expect(form.textContent).not.toMatch(/next assignment/i);
  });

  it('focus lands on the panel heading; Escape closes it and returns focus to Edit details', async () => {
    const { root } = await mountBar();
    await openEdit(root);
    expect(document.activeElement?.id).toBe('task-panel-edit-title');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick(2);
    expect(root.querySelector('#task-panel-edit')).toBeNull();
    expect(document.activeElement).toBe(button(root, 'Edit details'));
  });
});

describe('Edit details: an untouched start by keeps its instant (Beckett’s P2 on #1466)', () => {
  // 2026-11-01 06:30Z is the SECOND 01:30 in America/New_York (the clocks fall back at 06:00Z):
  // read back from the local string it would become the first one, 05:30Z, an hour earlier.
  const withZone = async (zone: string, run: () => Promise<void>) => {
    const was = process.env.TZ;
    process.env.TZ = zone;
    try {
      await run();
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  };

  it('posts the original instant for a control the reader did not touch', async () => {
    await withZone('America/New_York', async () => {
      const { root } = await mountBar({ startBy: '2026-11-01T06:30:00.000Z' });
      const form = await openEdit(root);
      expect(field(form, 'startBy').value).toBe('2026-11-01T01:30');
      expect(field(form, 'startByUtc').value).toBe('2026-11-01T06:30:00.000Z');
    });
  });

  it('computes the instant from the control once the reader changes it', async () => {
    await withZone('America/New_York', async () => {
      const { root } = await mountBar({ startBy: '2026-11-01T06:30:00.000Z' });
      const form = await openEdit(root);
      const input = field(form, 'startBy');
      input.value = '2026-11-02T09:00';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(2);
      flushSync();
      expect(field(form, 'startByUtc').value).toBe('2026-11-02T14:00:00.000Z');
    });
  });

  it('a task with no start by posts none', async () => {
    const { root } = await mountBar({ startBy: null });
    const form = await openEdit(root);
    expect(field(form, 'startByUtc').value).toBe('');
  });
});

describe('Edit details: results', () => {
  it('a save reloads, closes the panel and says "Details saved." in a status line', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'edit', ok: true } });
    await tick(2);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(root.querySelector('#task-panel-edit')).toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent?.trim()).toBe('Details saved.');
  });

  it('a save with nothing changed says "No changes to save." and never "saved"', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'edit', ok: true, unchanged: true } });
    await tick(2);
    const text = root.querySelector('[role="status"]')?.textContent?.trim();
    expect(text).toBe('No changes to save.');
  });

  it('a refusal stays in the panel with the draft, and the title error is inline', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    const title = field(form, 'title');
    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await submitEnhancedWithResult(form, { type: 'failure', status: 400, data: { action: 'edit', refusal: { kind: 'invalid', field: 'title', message: 'Give the task a title.' }, values: { title: '' } } });
    await tick(2);
    expect(root.querySelector('#task-panel-edit')).not.toBeNull();
    expect(root.querySelector('#task-panel-edit')!.textContent).toContain('Give the task a title.');
    expect(document.activeElement?.id).toBe('edit-title');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('TASK_NOT_OWNER stays in the panel, verbatim with its code, and the typed draft is kept', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    const title = field(form, 'title');
    title.value = 'My new title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const message = "Only the task's owner, a worker the owner reports to, or whoever manages the App, edits it.";
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { action: 'edit', refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message } } });
    await tick(2);
    const alert = root.querySelector('#task-panel-edit [role="alert"]');
    expect(alert?.textContent).toContain(`“${message}”`);
    expect(alert?.textContent).toContain('TASK_NOT_OWNER');
    expect(field(root.querySelector<HTMLFormElement>('#task-panel-edit')!, 'title').value).toBe('My new title');
  });

  it('an uncertain outcome says it may or may not have gone through, and keeps the draft (no "not changed")', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'failure', status: 502, data: { action: 'edit', refusal: { kind: 'uncertain' } } });
    await tick(2);
    const text = root.querySelector('#task-panel-edit [role="alert"]')!.textContent!;
    expect(text).toMatch(/may or may not/i);
    expect(text).not.toMatch(/not changed/i);
  });

  it('a task finished in another tab (TASK_ENDED) reloads, closes the panel and shows no success', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { action: 'edit', refusal: { kind: 'refused', code: 'TASK_ENDED', message: 'This task has ended.' } } });
    await tick(2);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(root.querySelector('#task-panel-edit')).toBeNull();
    expect(root.textContent).toContain('This task has ended.');
    expect(root.textContent).not.toContain('Details saved.');
  });

  it('the submit button is disabled while the save is in flight', async () => {
    const { root } = await mountBar();
    const form = await openEdit(root);
    const finish = await beginEnhanced(form);
    await tick(2);
    flushSync();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await finish({ type: 'success', status: 200, data: { action: 'edit', ok: true } });
  });
});

describe('Edit details: drafts and navigation', () => {
  it('a data refresh while the panel is open does not reseed what the reader typed', async () => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    const title = field(form, 'title');
    title.value = 'Half-typed';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    props.task = task({ title: 'Changed by someone else', updatedAt: '2026-10-30T00:00:00Z' });
    await tick(2);
    flushSync();
    expect(field(root.querySelector<HTMLFormElement>('#task-panel-edit')!, 'title').value).toBe('Half-typed');
  });

  it('moving to another task closes the panel: a draft for one task never posts to another', async () => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    field(form, 'title').value = 'Draft for t1';
    props.task = task({ id: 't2', title: 'Other task' });
    await tick(2);
    flushSync();
    expect(root.querySelector('#task-panel-edit')).toBeNull();
  });

  it('a save for one task that finishes after the reader moved to another shows nothing on the other', async () => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    const finish = await beginEnhanced(form);
    props.task = task({ id: 't2', title: 'Other task' });
    await tick(2);
    await finish({ type: 'success', status: 200, data: { action: 'edit', ok: true } });
    await tick(2);
    expect(root.textContent).not.toContain('Details saved.');
  });

  // Gabriel's LOCAL P2 on #1466: the failure path is the fourth piece of bar state and needs the same task guard.
  it.each([
    ['a stale refusal (TASK_ENDED)', { kind: 'refused', code: 'TASK_ENDED', message: 'This task has ended.' }, 409],
    ['an in-panel refusal (TASK_NOT_OWNER)', { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Only the owner edits it.' }, 403],
    ['an uncertain outcome', { kind: 'uncertain' }, 502]
  ])('%s that lands after the reader moved to another task shows nothing on the other', async (_name, refusal, status) => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    const finish = await beginEnhanced(form);
    props.task = task({ id: 't2', title: 'Other task' });
    await tick(2);
    await finish({ type: 'failure', status, data: { action: 'edit', refusal } });
    await tick(2);
    flushSync();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).not.toContain('This task has ended.');
    expect(root.textContent).not.toContain('TASK_');
  });

  it('a refusal already showing for one task is gone once the reader moves to another', async () => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { action: 'edit', refusal: { kind: 'refused', code: 'TASK_ENDED', message: 'This task has ended.' } } });
    await tick(2);
    expect(root.textContent).toContain('TASK_ENDED');
    props.task = task({ id: 't2', title: 'Other task' });
    await tick(2);
    flushSync();
    expect(root.textContent).not.toContain('TASK_ENDED');
  });

  it('a refusal for the task in view still shows after that same task reloads', async () => {
    const { root, props } = await mountBar();
    const form = await openEdit(root);
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { action: 'edit', refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Only the owner edits it.' } } });
    await tick(2);
    props.task = task({ updatedAt: '2026-10-30T00:00:00Z' });
    await tick(2);
    flushSync();
    expect(root.textContent).toContain('TASK_NOT_OWNER');
  });
});
