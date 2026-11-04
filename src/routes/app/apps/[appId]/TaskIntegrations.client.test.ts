/**
 * portal#1607 — the App's task integrations on the Settings tab: who sees the
 * section and its controls, what the save posts, and how each refusal and each
 * team whose lead is not a live worker is handled.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import TaskIntegrations from './TaskIntegrations.svelte';

const IRIS = 'hrn:worker:x.com:app:iris';
const OLD = 'hrn:worker:x.com:app:old';
const workers = [
  { id: 'w1', name: 'Iris', urn: IRIS, retiredAt: null },
  { id: 'w2', name: 'Bram', urn: 'hrn:worker:x.com:app:bram', retiredAt: null },
  { id: 'w3', name: 'Olga', urn: OLD, retiredAt: '2026-10-01T00:00:00Z' },
];
const wire = (name: string, lead: string | null = IRIS) => ({
  name, provider: 'github', repositories: ['o/a', 'o/b'], readyLabel: 'ready', excludeLabels: ['wip'],
  teams: [{ lead, label: 'team:x' }],
});
const ok = (properties: unknown, revision = 3) => ({ kind: 'ok' as const, properties, revision });

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); resetNavigationCalls(); });

async function mount(read: unknown, manages: boolean | null = true, staff: unknown = workers) {
  const m = mountComponent(TaskIntegrations as never, { read, manages, workers: staff } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const click = async (b: HTMLButtonElement | undefined) => { expect(b).toBeTruthy(); b!.click(); await tick(3); };
async function type(el: HTMLInputElement, value: string) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await tick(2); }
async function pick(el: HTMLSelectElement, value: string) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await tick(2); }
const form = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLFormElement>('form')!;
const posted = (m: Mounted<Record<string, unknown>>) => JSON.parse(form(m).querySelector<HTMLInputElement>('input[name="integrations"]')!.value);
const result = (r: unknown) => ({ type: 'success' as const, status: 200, data: { taskIntegrationsResult: r } });

describe('visibility', () => {
  it('a caller who may not read (hidden) sees no section at all', async () => {
    const m = await mount({ kind: 'hidden' });
    expect(m.target.querySelector('[data-task-integrations]')).toBeNull();
    expect(m.target.textContent?.trim()).toBe('');
  });
  it('a manager with no properties yet (revision 0) gets an empty section with an add control', async () => {
    const m = await mount(ok(null, 0), true);
    expect(m.target.textContent).toContain('None configured');
    await click(btn(m.target, 'Add integration'));
    expect(form(m)).toBeTruthy();
    expect(posted(m)).toHaveLength(1);
  });
  it('a reader who does not manage gets the list read-only', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }), false);
    expect(m.target.textContent).toContain('core');
    expect(btn(m.target, 'Edit')).toBeUndefined();
    expect(btn(m.target, 'Add integration')).toBeUndefined();
    expect(m.target.querySelector('form')).toBeNull();
  });
  it('a reader sees None configured, without controls', async () => {
    const m = await mount(ok(null, 0), false);
    expect(m.target.textContent).toContain('None configured');
    expect(btn(m.target, 'Add integration')).toBeUndefined();
  });
  it('a manager gets the edit controls', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }), true);
    expect(btn(m.target, 'Edit')).toBeTruthy();
  });
  it('a failed read is said, never an empty section', async () => {
    const m = await mount({ kind: 'failed' });
    expect(m.target.querySelector('[role="alert"]')).toBeTruthy();
    expect(m.target.textContent).not.toContain('None configured');
  });
  it('no edit controls when the roster could not be read (leads cannot be picked)', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }), true, null);
    expect(btn(m.target, 'Edit')).toBeUndefined();
  });
});

describe('the list', () => {
  it('shows the lead by name with the URN chip below, and the team label', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    const team = m.target.querySelector('[data-team-label="team:x"]')!;
    expect(team.textContent).toContain('Iris');
    expect(team.textContent).toContain('x.com:app:iris');
  });
  it('two integrations with the same name both render (no duplicate keys)', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('same'), wire('same')] }));
    expect(m.target.querySelectorAll('[data-integration="same"]')).toHaveLength(2);
  });
  it('marks a retired lead and an unknown (null) lead', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', OLD), wire('b', null)] }));
    expect(m.target.textContent).toContain('No longer a live worker');
    expect(m.target.textContent).toContain('Unknown worker');
  });
});

describe('a lead that isn\'t a live worker (portal#1676)', () => {
  const GONE = 'hrn:worker:x.com:app:gone';
  const MISSING = 'Worker not in this App’s list';
  const MISSING_NOTE = 'Can’t confirm it is still live.';
  const UNCHECKED = 'Couldn’t check this worker';
  const UNCHECKED_NOTE = 'The worker list didn’t load, so we can’t tell if it is still live.';
  const RETIRED_NOTE = 'No longer a live worker';
  const chip = (root: ParentNode, urn: string) => root.querySelector(`[title="${urn}"]`);
  /** Text outside the chip: a URN here is one a reader can't copy. */
  function bareText(root: Element) {
    const copy = root.cloneNode(true) as Element;
    copy.querySelectorAll('[title]').forEach((n) => n.remove());
    return copy.textContent ?? '';
  }

  it('L1: in the list, a lead the roster lacks gets the label, the note and the chip', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core', GONE)] }));
    const team = m.target.querySelector('[data-team-label="team:x"]')!;
    expect(team.textContent).toContain(MISSING);
    expect(team.textContent).toContain(MISSING_NOTE);
    expect(chip(team, GONE)).not.toBeNull();
    expect(bareText(team)).not.toContain('gone');
    expect(team.textContent).not.toContain(RETIRED_NOTE);
  });
  it('L1: in the form, the option is the label, the chip is below, and the lead saves unchanged', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core', GONE)] }));
    await click(btn(m.target, 'Edit'));
    const box = form(m).querySelector('[data-team="0"]')!;
    const select = box.querySelector<HTMLSelectElement>('select')!;
    const option = select.options[select.selectedIndex];
    expect(option.value).toBe(GONE);
    expect(option.text).toBe(MISSING);
    expect(chip(box, GONE)).not.toBeNull();
    expect(box.textContent).toContain(MISSING_NOTE);
    expect(box.textContent).not.toContain(RETIRED_NOTE);
    expect(posted(m)[0].teams[0].lead).toBe(GONE);
  });
  it('L2: a failed roster read says so, retires nobody, and offers no form', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', IRIS), wire('b', OLD)] }), true, null);
    const text = m.target.textContent;
    expect(text).toContain(UNCHECKED);
    expect(text).toContain(UNCHECKED_NOTE);
    expect(text).not.toContain(RETIRED_NOTE);
    expect(chip(m.target, IRIS)).not.toBeNull();
    expect(chip(m.target, OLD)).not.toBeNull();
    expect(btn(m.target, 'Edit')).toBeUndefined();
  });
  it('a roster read that fails mid-edit keeps the chosen lead, labelled and saved unchanged', async () => {
    const props = reactiveProps({ read: ok({ taskIntegrations: [wire('core', IRIS)] }), manages: true, workers: workers as unknown });
    const m = mountComponent(TaskIntegrations as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    await click(btn(m.target, 'Edit'));
    props.workers = null;
    await tick(3);
    const select = form(m).querySelector<HTMLSelectElement>('select[id*="teams"]')!;
    expect(select.value).toBe(IRIS);
    expect(select.options[select.selectedIndex].text).toBe(UNCHECKED);
    expect(form(m).textContent).toContain(UNCHECKED_NOTE);
    expect(form(m).textContent).not.toContain(RETIRED_NOTE);
    expect(posted(m)[0].teams[0].lead).toBe(IRIS);
  });
  it('L3: a named retired lead and a null lead read as before', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', OLD), wire('b', null)] }));
    const [retired, none] = [...m.target.querySelectorAll('[data-team-label="team:x"]')];
    expect(retired.textContent).toContain('Olga');
    expect(retired.textContent).toContain(RETIRED_NOTE);
    expect(chip(retired, OLD)).not.toBeNull();
    expect(none.textContent).toContain('Unknown worker');
    expect(none.querySelector('[title]')).toBeNull();
  });
  it('L4: missing, unchecked and null each read differently', async () => {
    const shown = await mount(ok({ taskIntegrations: [wire('a', GONE), wire('b', null)] }));
    const failed = await mount(ok({ taskIntegrations: [wire('a', GONE)] }), true, null);
    const [missing, none] = [...shown.target.querySelectorAll('[data-team-label="team:x"]')].map((n) => bareText(n));
    const unchecked = bareText(failed.target.querySelector('[data-team-label="team:x"]')!);
    expect(new Set([missing, unchecked, none]).size).toBe(3);
  });
});

describe('the form', () => {
  it('the lead picker lists only the live workers of the roster', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const options = [...form(m).querySelectorAll<HTMLOptionElement>('select[id*="teams"] option')].map((o) => o.value);
    expect(options).toEqual([IRIS, 'hrn:worker:x.com:app:bram']);
  });
  it('posts the lead URN of the chosen worker and the revision it read', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }, 7));
    await click(btn(m.target, 'Edit'));
    await pick(form(m).querySelector<HTMLSelectElement>('select[id*="teams"]')!, 'hrn:worker:x.com:app:bram');
    expect(posted(m)[0].teams[0].lead).toBe('hrn:worker:x.com:app:bram');
    expect(form(m).querySelector<HTMLInputElement>('input[name="revision"]')!.value).toBe('7');
  });
  it('a conflict says so, offers Reload, and Reload re-reads without a second write', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: false, code: 'APP_PROPERTIES_CONFLICT', message: 'Someone else changed these settings.', path: null, currentRevision: 5 }));
    await tick(3);
    expect(form(m).textContent).toContain('Someone else changed these settings.');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    await click(btn(form(m) ?? m.target, 'Reload (discards your changes)'));
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(m.target.querySelector('form')).toBeNull();
  });
  it('TASK_INTEGRATION_INVALID shows at the input its path names, and keeps the typed values', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const repo = form(m).querySelector<HTMLInputElement>('input[id$="repositories-1"]')!;
    await type(repo, 'typed/value');
    await submitEnhancedWithResult(form(m), result({ ok: false, code: 'TASK_INTEGRATION_INVALID', message: 'No such repository.', path: 'taskIntegrations[0].repositories[1]', currentRevision: null }));
    await tick(3);
    const err = form(m).querySelector('#ti-taskIntegrations-0-repositories-1-error')!;
    expect(err.textContent).toContain('No such repository.');
    expect(form(m).querySelector<HTMLInputElement>('input[id$="repositories-1"]')!.getAttribute('aria-describedby')).toBe(err.id);
    expect(form(m).querySelector<HTMLInputElement>('input[id$="repositories-1"]')!.value).toBe('typed/value');
  });
  it('a success re-reads the App and closes the form', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: true, revision: 4 }));
    await tick(3);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(m.target.querySelector('form')).toBeNull();
  });
});

describe('a team whose lead is no longer a live worker', () => {
  it('retired: marked in the form, kept (not dropped), and the server refusal shows at the lead and keeps typed values', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', OLD), wire('b')] }));
    await click(btn(m.target, 'Edit'));
    expect(form(m).textContent).toContain('No longer a live worker');
    expect(posted(m)[0].teams[0].lead).toBe(OLD);
    await type(form(m).querySelectorAll<HTMLInputElement>('input[id$="readyLabel"]')[1], 'typed-label');
    const { cancelled } = await submitEnhancedWithResult(form(m), result({ ok: false, code: 'TASK_INTEGRATION_INVALID', message: 'Lead is retired.', path: 'taskIntegrations[0].teams[0].lead', currentRevision: null }));
    expect(cancelled).toBe(false);
    await tick(3);
    expect(form(m).querySelector('#ti-taskIntegrations-0-teams-0-lead-error')!.textContent).toContain('Lead is retired.');
    expect(form(m).querySelectorAll<HTMLInputElement>('input[id$="readyLabel"]')[1].value).toBe('typed-label');
    // Picking a live lead then posts it.
    await pick(form(m).querySelector<HTMLSelectElement>('#ti-taskIntegrations-0-teams-0-lead')!, IRIS);
    expect(posted(m)[0].teams[0].lead).toBe(IRIS);
  });
  it('unknown (null): shows "Unknown worker", blocks the save in the browser, never posts null', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', null)] }));
    await click(btn(m.target, 'Edit'));
    expect(form(m).textContent).toContain('Unknown worker');
    const { cancelled } = await submitEnhancedWithResult(form(m), result({ ok: true, revision: 4 }));
    expect(cancelled).toBe(true);
    await tick(3);
    expect(form(m).querySelector('#ti-taskIntegrations-0-teams-0-lead-error')).toBeTruthy();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
  it('removing that team unblocks the save', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('a', null)] }));
    await click(btn(m.target, 'Edit'));
    await click(btn(form(m), 'Remove team'));
    expect(posted(m)[0].teams).toEqual([]);
    const { cancelled } = await submitEnhancedWithResult(form(m), result({ ok: true, revision: 4 }));
    expect(cancelled).toBe(false);
  });
});

// UX review of #1614 (P2-1, P2-2): focus must go somewhere useful, and repeated buttons need distinct names.
describe('focus and names', () => {
  const active = () => document.activeElement as HTMLElement | null;
  it('Edit moves focus to the first field; Add integration to the new integration\'s name', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    document.body.append(m.target);
    await click(btn(m.target, 'Edit'));
    expect(active()?.id).toBe('ti-taskIntegrations-0-name');
    await click(btn(form(m), 'Add integration'));
    expect(active()?.id).toBe('ti-taskIntegrations-1-name');
  });
  it('Cancel and a successful Save return focus to the section heading', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    document.body.append(m.target);
    await click(btn(m.target, 'Edit'));
    await click(btn(form(m), 'Cancel'));
    expect(active()?.id).toBe('task-integrations-heading');
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: true, revision: 4 }));
    await tick(4);
    expect(active()?.id).toBe('task-integrations-heading');
  });
  it('a failed validation focuses the first invalid field, not the Save button', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core', null)] }));
    document.body.append(m.target);
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: true, revision: 4 }));
    await tick(4);
    expect(active()?.id).toBe('ti-taskIntegrations-0-teams-0-lead');
  });
  it('a conflict banner takes focus', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    document.body.append(m.target);
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: false, code: 'APP_PROPERTIES_CONFLICT', message: 'Changed.', path: null, currentRevision: 5 }));
    await tick(4);
    expect(active()?.getAttribute('role')).toBe('alert');
  });
  it('every Remove button has its own accessible name', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const names = [...form(m).querySelectorAll('button')].filter((b) => /^Remove/.test(b.textContent?.trim() ?? '')).map((b) => b.getAttribute('aria-label'));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Remove repository 1', 'Remove repository 2', 'Remove excluded label 1', 'Remove team team:x', 'Remove integration core']));
  });
});

// LOCAL review of #1614 (Gizelle): an old draft, an old response, never act on newer state.
describe('interleavings', () => {
  const revisionField = (m: Mounted<Record<string, unknown>>) => form(m).querySelector<HTMLInputElement>('input[name="revision"]')!.value;
  async function mountReactive(read: unknown) {
    const props = reactiveProps<Record<string, unknown>>({ read, manages: true, workers });
    const m = mountComponent(TaskIntegrations as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return { m, props };
  }
  it('a loader refresh mid-edit keeps the draft\'s own revision (the server then refuses it as a conflict)', async () => {
    const { m, props } = await mountReactive(ok({ taskIntegrations: [wire('core')] }, 3));
    await click(btn(m.target, 'Edit'));
    expect(revisionField(m)).toBe('3');
    props.read = ok({ taskIntegrations: [wire('changed-elsewhere')] }, 4);
    await tick(3);
    expect(posted(m)[0].name).toBe('core');
    expect(revisionField(m)).toBe('3');
  });
  it('a new edit session takes the revision current at its start', async () => {
    const { m, props } = await mountReactive(ok({ taskIntegrations: [wire('core')] }, 3));
    await click(btn(m.target, 'Edit'));
    await click(btn(form(m), 'Cancel'));
    props.read = ok({ taskIntegrations: [wire('core')] }, 4);
    await tick(2);
    await click(btn(m.target, 'Edit'));
    expect(revisionField(m)).toBe('4');
  });
  it('an old save that succeeds after Cancel + Edit again leaves the newer editor and its typed values alone', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const held = await submitEnhancedDeferred(form(m));
    await click(btn(form(m), 'Cancel'));
    await click(btn(m.target, 'Edit'));
    await type(form(m).querySelector<HTMLInputElement>('#ti-taskIntegrations-0-name')!, 'newer-draft');
    await held.finish(result({ ok: true, revision: 4 }));
    await tick(4);
    expect(form(m)).toBeTruthy();
    expect(posted(m)[0].name).toBe('newer-draft');
  });
  it('an old refusal does not paint its error onto a newer editor', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const held = await submitEnhancedDeferred(form(m));
    await click(btn(form(m), 'Cancel'));
    await click(btn(m.target, 'Edit'));
    await held.finish(result({ ok: false, code: 'APP_PROPERTIES_CONFLICT', message: 'Old conflict.', path: null, currentRevision: 9 }));
    await tick(4);
    expect(form(m).textContent).not.toContain('Old conflict.');
  });
  it('the current session\'s own success still closes the form', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    const held = await submitEnhancedDeferred(form(m));
    await held.finish(result({ ok: true, revision: 4 }));
    await tick(4);
    expect(m.target.querySelector('form')).toBeNull();
  });
  it('a Reload still in flight does not close a newer Cancel/Edit session or its typed values', async () => {
    const m = await mount(ok({ taskIntegrations: [wire('core')] }));
    await click(btn(m.target, 'Edit'));
    await submitEnhancedWithResult(form(m), result({ ok: false, code: 'APP_PROPERTIES_CONFLICT', message: 'Changed.', path: null, currentRevision: 5 }));
    await tick(3);
    const release = holdInvalidateAll();
    await click(btn(form(m), 'Reload (discards your changes)'));
    await click(btn(form(m), 'Cancel'));
    await click(btn(m.target, 'Edit'));
    await type(form(m).querySelector<HTMLInputElement>('#ti-taskIntegrations-0-name')!, 'newer-draft');
    release();
    await tick(4);
    expect(form(m)).toBeTruthy();
    expect(posted(m)[0].name).toBe('newer-draft');
  });
});
