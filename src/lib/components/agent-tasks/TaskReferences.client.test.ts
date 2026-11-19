/**
 * portal#1575 — editing a task's references in the real Edit details panel
 * (hadron-server#3112; hrn:node:hadronmemory.com:specs:cor:agt:050:09).
 *
 * Add (choose a kind, enter or pick the target, optional label), remove and
 * reorder; the form posts the whole ordered list beside the list it opened
 * with. NODE is picked with SelectNode (#1576 step 2) — never typed; the
 * target is the picker's SERVER-supplied URN. TASK is picked, never typed,
 * including an ended task. A refusal keeps the draft list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskActionBar from './TaskActionBar.svelte';
import SelectTask from './SelectTask.svelte';

const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const issue = { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'The bug' };
const node = { kind: 'NODE', target: 'hrn:node:acme.com:team:x', label: null };
const link = { kind: 'URL', target: 'https://example.com/notes', label: null };
const task = (references: unknown[]) => ({
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'PENDING', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: null, startBy: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: false, result: null, sessionEndRequest: null,
  references,
});

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openEdit(references: unknown[] = [], nodeMemories: unknown = { kind: 'ok', value: [{ id: 'm1', name: 'Team KB', urn: 'hrn:mem:acme.com:team', visibility: null }] }) {
  const p = reactiveProps<Record<string, unknown>>({
    task: task(references), canWrite: true, impersonating: null, loadPickers: async () => ({ kind: 'ok' as const, value: { workers: [], people: [], roles: [], families: [] } }),
    openChildren: { count: 0, capped: false }, appUrn: 'hrn:app:acme.com:team',
    // portal#1576: the NODE picker's memory stage (the page streams this).
    loadMemories: async () => (nodeMemories instanceof Promise ? await nodeMemories : nodeMemories) as never,
  });
  const m = mountComponent(TaskActionBar as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Edit details')!.click();
  await tick(2);
  return m.target.querySelector<HTMLFormElement>('#task-panel-edit')!;
}

/**
 * The node picker's endpoint page, URL-routed like the component's own test.
 * `nextOffset` is explicit at every call site (#1582 BLIND delta P3): it is
 * the server's RAW-count word on where the next page starts — offset +
 * raw window length — and a silent `items.length` default is only that for
 * an unfiltered first page from offset 0.
 */
const nodePage = (items: Array<{ id: string; name: string; loc: string; urn: string }>, hasMore: boolean, nextOffset: number) =>
  ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore, nextOffset } }) });
const nodesUrl = (query: string, offset: number) => `/app/memories/m1/nodes/choices?query=${query}&offset=${offset}`;

/** Open the NODE picker, choose its one memory, search, and Select the first row. */
async function pickNode(form: HTMLFormElement, choice: { id: string; name: string; loc: string; urn: string }, query = 'finding') {
  const fetch = vi.fn().mockResolvedValue(nodePage([choice], false, 1));
  vi.stubGlobal('fetch', fetch);
  await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'NODE');
  buttonText(form, 'Choose a node…')!.click();
  await tick(4);
  // The memory stage: SelectNode reuses SelectMemory over the caller's set.
  buttonText(document.body, 'Select')!.click();
  await tick(4);
  // The search box is named by its visible wrapping label ("Search nodes"),
  // not an aria-label of its own (#1582 BLIND delta P3,
  // hrn:node:hadronmemory.com:hadron-portal:review:visible-label-is-the-accessible-name)
  // — find it through the label.
  const search = ([...document.body.querySelectorAll('label')].find((l) => l.textContent?.includes('Search nodes'))!).querySelector<HTMLInputElement>('input')!;
  search.value = query;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  buttonText(document.body, 'Find')!.click();
  await tick(6);
  buttonText(document.body, 'Select')!.click();
  await tick(2);
  return fetch;
}

const posted = (form: HTMLFormElement) => JSON.parse(form.querySelector<HTMLInputElement>('input[name="references"]')!.value);
const base = (form: HTMLFormElement) => JSON.parse(form.querySelector<HTMLInputElement>('input[name="referencesBase"]')!.value);
const byLabel = (root: HTMLElement, label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonText = (root: HTMLElement, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
async function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}
async function choose(el: HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await tick(2);
}

describe('Edit details: references (acceptance 6, the form side)', () => {
  it('opens with the task’s list as both the draft and its base', async () => {
    const form = await openEdit([issue, node]);
    expect(base(form)).toEqual([issue, node]);
    expect(posted(form)).toEqual([issue, node]);
    expect(form.querySelectorAll('[data-testid="edit-reference-list"] > li')).toHaveLength(2);
  });

  it('adds a URL reference with a label at the end', async () => {
    const form = await openEdit([issue]);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    await type(form.querySelector<HTMLInputElement>('#edit-ref-target')!, 'https://example.com/notes');
    await type(form.querySelector<HTMLInputElement>('#edit-ref-label')!, 'Notes');
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(posted(form)).toEqual([issue, { kind: 'URL', target: 'https://example.com/notes', label: 'Notes' }]);
    // The add fields post nothing themselves: only the list goes.
    expect(form.querySelector<HTMLInputElement>('#edit-ref-target')!.name).toBe('');
    expect(form.querySelector<HTMLInputElement>('#edit-ref-target')!.value).toBe('');
  });

  it('Enter in the add fields adds the reference and never submits the edit form', async () => {
    const form = await openEdit([]);
    const submit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener('submit', submit);
    const target = form.querySelector<HTMLInputElement>('#edit-ref-target')!;
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    await type(target, 'https://example.com/a');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(enter);
    await tick(2);
    expect(enter.defaultPrevented).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(posted(form)).toEqual([{ kind: 'URL', target: 'https://example.com/a', label: null }]);
  });

  it('removes one, and removing the last leaves []', async () => {
    const form = await openEdit([issue, node]);
    byLabel(form, 'Remove reference 1')!.click();
    await tick(2);
    expect(posted(form)).toEqual([node]);
    byLabel(form, 'Remove reference 1')!.click();
    await tick(2);
    expect(posted(form)).toEqual([]);
  });

  it('reorders with Move up / Move down, and the ends offer no move past them', async () => {
    const form = await openEdit([issue, node, link]);
    expect(byLabel(form, 'Move reference 1 up')!.disabled).toBe(true);
    expect(byLabel(form, 'Move reference 3 down')!.disabled).toBe(true);
    byLabel(form, 'Move reference 3 up')!.click();
    await tick(2);
    expect(posted(form)).toEqual([issue, link, node]);
    byLabel(form, 'Move reference 1 down')!.click();
    await tick(2);
    expect(posted(form)).toEqual([link, issue, node]);
  });

  it('a refusal keeps the draft list in the panel (acceptance 7)', async () => {
    const form = await openEdit([issue]);
    byLabel(form, 'Remove reference 1')!.click();
    await tick(2);
    await pickNode(form, { id: 'n1', name: 'Findings index', loc: 'findings:index', urn: 'hrn:node:acme.com:team:y' });
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    const message = 'references[0].target: no such node';
    await submitEnhancedWithResult(form, { type: 'failure', status: 400, data: { action: 'edit', refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message } } });
    await tick(2);
    const still = document.querySelector<HTMLFormElement>('#task-panel-edit')!;
    expect(still.textContent).toContain(message);
    expect(posted(still)).toEqual([{ kind: 'NODE', target: 'hrn:node:acme.com:team:y', label: null }]);
  });
});

describe('the NODE pick (acceptance 5, #1576 step 2)', () => {
  // The server urn deliberately differs from any memory-urn + loc concatenation.
  const choice = { id: 'n1', name: 'Findings index', loc: 'findings:index', urn: 'hrn:node:acme.com:team:special-alias' };

  it('is picked, never typed: no NODE text field, and the SERVER urn is the target', async () => {
    const form = await openEdit([]);
    const fetch = await pickNode(form, choice);
    // The read went out with the viewer's session (the endpoint), one memory.
    expect(fetch).toHaveBeenCalledWith(nodesUrl('finding', 0));
    expect(form.querySelector('#edit-ref-target')).toBeNull();
    expect(form.textContent).toContain('Findings index');
    expect(form.textContent).toContain('findings:index');
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(posted(form)).toEqual([{ kind: 'NODE', target: 'hrn:node:acme.com:team:special-alias', label: null }]);
  });

  it('a picked but un-added node blocks submit, so it is never silently dropped', async () => {
    const form = await openEdit([]);
    await pickNode(form, choice);
    expect(form.checkValidity()).toBe(false);
    expect(form.querySelector<HTMLInputElement>('#edit-ref-label')!.validationMessage).toBe('Add this reference, or clear the selection.');
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(form.checkValidity()).toBe(true);
    expect(posted(form)).toEqual([{ kind: 'NODE', target: 'hrn:node:acme.com:team:special-alias', label: null }]);
  });

  it('Clear drops the pick and unblocks submit, posting nothing for it', async () => {
    const form = await openEdit([]);
    await pickNode(form, choice);
    byLabel(form, 'Clear the selected node')!.click();
    await tick(2);
    expect(form.textContent).not.toContain('Findings index');
    expect(buttonText(form, 'Add reference')!.disabled).toBe(true);
    expect(form.checkValidity()).toBe(true);
    expect(posted(form)).toEqual([]);
  });

  // BLIND P3 (#1582 at d9d2c8c5): the streamed memory list rejecting left the
  // {#await} with no catch arm, so "Choose a node…" silently did nothing.
  // AMENDED for #1585: the degraded mount STAYS (the picker opens on a
  // rejected stream), but the memory stage now says the memories failed
  // instead of posing as an empty readable set — the old pin asserted the
  // empty stage's "Pick which memory to search in first." verbatim.
  it('a rejected memory stream still opens the picker, with the stage saying the memories failed', async () => {
    // The no-op catch marks the rejection OBSERVED for the runner; the
    // component still sees a rejected promise, which is the defect's input.
    const rejected = Promise.reject(new Error('memories read failed'));
    rejected.catch(() => {});
    const form = await openEdit([], rejected);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'NODE');
    buttonText(form, 'Choose a node…')!.click();
    await tick(4);
    const dialog = [...document.body.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute('aria-label') === 'Choose a node',
    );
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
    expect(dialog!.textContent).not.toContain('Pick which memory to search in first.');
  });

  // BLIND P3 (#1582 at d9d2c8c5): Clear removed the focused button and left
  // focus on <body>; keyboard users lost their place in the form.
  it('Clear returns focus to the Choose node… trigger', async () => {
    const form = await openEdit([]);
    await pickNode(form, choice);
    byLabel(form, 'Clear the selected node')!.click();
    await tick(2);
    expect(document.activeElement).toBe(buttonText(form, 'Choose a node…'));
  });

  it('a typed but un-added target blocks submit, so it is never silently dropped', async () => {
    const form = await openEdit([]);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    await type(form.querySelector<HTMLInputElement>('#edit-ref-target')!, 'https://example.com/pending');
    expect(form.checkValidity()).toBe(false);
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(form.checkValidity()).toBe(true);
  });
});

describe('the TASK pick (acceptance 3 in the form)', () => {
  const answer = (items: unknown[]) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore: false } }) });

  it('is picked, never typed, and becomes hrn:agenttask:<app key>:<handle>', async () => {
    const fetch = vi.fn().mockResolvedValue(answer([{ id: 'x1', appId: 'app-1', title: 'Old work', handle: 'AT0.3898', status: 'FINISHED' }]));
    vi.stubGlobal('fetch', fetch);
    const form = await openEdit([]);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'TASK');
    expect(form.querySelector('#edit-ref-target')).toBeNull();
    buttonText(form, 'Choose a task…')!.click();
    await tick(6);
    // The reference picker asks for ended tasks too.
    expect(String(fetch.mock.calls[0]![0])).toContain('ended=1');
    buttonText(document.body, 'Select')!.click();
    await tick(2);
    expect(form.textContent).toContain('Old work');
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(posted(form)).toEqual([{ kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT0.3898', label: null }]);
  });

  // #1578 BLIND P2 (Gizelle): a picked task not yet added was dropped by the outer Save.
  async function pickOld(form: HTMLFormElement) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer([{ id: 'x1', appId: 'app-1', title: 'Old work', handle: 'AT0.3898', status: 'FINISHED' }])));
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'TASK');
    buttonText(form, 'Choose a task…')!.click();
    await tick(6);
    buttonText(document.body, 'Select')!.click();
    await tick(2);
  }

  it('a picked but un-added task blocks submit, so it is never silently dropped', async () => {
    const form = await openEdit([]);
    await pickOld(form);
    expect(form.checkValidity()).toBe(false);
    expect(form.querySelector<HTMLInputElement>('#edit-ref-label')!.validationMessage).toBe('Add this reference, or clear the selection.');
    buttonText(form, 'Add reference')!.click();
    await tick(2);
    expect(form.checkValidity()).toBe(true);
    expect(posted(form)).toEqual([{ kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT0.3898', label: null }]);
  });

  it('Clear selection drops the pick and unblocks submit, posting nothing for it', async () => {
    const form = await openEdit([]);
    await pickOld(form);
    byLabel(form, 'Clear the selected task')!.click();
    await tick(2);
    expect(form.textContent).not.toContain('Old work');
    expect(buttonText(form, 'Add reference')!.disabled).toBe(true);
    expect(form.checkValidity()).toBe(true);
    expect(posted(form)).toEqual([]);
  });

  it('switching kind never leaves a hidden draft behind (a pick, or a typed target)', async () => {
    const form = await openEdit([]);
    await pickOld(form);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    expect(form.checkValidity()).toBe(true);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'TASK');
    expect(form.textContent).not.toContain('Old work');
    expect(form.checkValidity()).toBe(true);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    await type(form.querySelector<HTMLInputElement>('#edit-ref-target')!, 'https://example.com/pending');
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'TASK');
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    expect(form.querySelector<HTMLInputElement>('#edit-ref-target')!.value).toBe('');
    expect(posted(form)).toEqual([]);
    // A picked NODE is cleared the same way, in both directions.
    await pickNode(form, { id: 'n1', name: 'Findings index', loc: 'findings:index', urn: 'hrn:node:acme.com:team:special-alias' });
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'URL');
    expect(form.textContent).not.toContain('Findings index');
    expect(form.checkValidity()).toBe(true);
    await choose(form.querySelector<HTMLSelectElement>('#edit-ref-kind')!, 'NODE');
    expect(buttonText(form, 'Add reference')!.disabled).toBe(true);
    expect(posted(form)).toEqual([]);
  });
});

describe('SelectTask statuses option (acceptance 4)', () => {
  const answer = () => ({ ok: true, json: async () => ({ kind: 'ok', value: { items: [], hasMore: false } }) });
  async function mountPicker(props: Record<string, unknown>) {
    const fetch = vi.fn().mockResolvedValue(answer());
    vi.stubGlobal('fetch', fetch);
    const m = mountComponent(SelectTask, { appId: 'app', open: true, onselect: vi.fn(), ...props } as never);
    mounted.push(m);
    await tick(5);
    return fetch;
  }
  it('the default (new-task parent, TaskPlanning) asks for open tasks only', async () => {
    const fetch = await mountPicker({});
    expect(String(fetch.mock.calls[0]![0])).not.toContain('ended');
  });
  it('includeEnded asks for ended tasks too', async () => {
    const fetch = await mountPicker({ includeEnded: true });
    expect(String(fetch.mock.calls[0]![0])).toContain('ended=1');
  });
});
